# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

from contextlib import asynccontextmanager

import pytest
import yaml

from mirage import EXTERNAL_COMMANDS, MountMode, RAMResource, Workspace
from mirage.config import _build_runtime_entries
from mirage.runtime.base import Runtime
from mirage.runtime.mixin import ProcessExecutorMixin
from mirage.runtime.types import ProcessExecution, RunResult


class ProcessProbe(Runtime, ProcessExecutorMixin):
    name = "probe"
    captures = (EXTERNAL_COMMANDS, )

    def __init__(self, **options):
        super().__init__(**options)
        self.requests: list[ProcessExecution] = []

    async def run_process(self, request: ProcessExecution) -> RunResult:
        self.requests.append(request)
        return RunResult(stdout=request.stdin or b"GPU ready\nother\n",
                         stderr=None,
                         exit_code=0)


@asynccontextmanager
async def workspace(*args, **kwargs):
    ws = Workspace(*args, **kwargs)
    try:
        yield ws
    finally:
        await ws.close()


@pytest.mark.asyncio
async def test_external_fallback_preserves_vfs_pipes_and_redirects():
    probe = ProcessProbe()
    async with workspace({"/": RAMResource()},
                         mode=MountMode.EXEC,
                         runtimes=[probe]) as ws:
        result = await ws.execute(
            "printf 'GPU ready\nother\n' | native-tool | grep GPU > /out")
        assert result.exit_code == 0
        assert await result.stdout_str() == ""
        assert await (await
                      ws.execute("cat /out")).stdout_str() == "GPU ready\n"
        assert probe.requests[0].argv == ("native-tool", )
        assert probe.requests[0].stdin == b"GPU ready\nother\n"
        assert len(probe.requests) == 1


@pytest.mark.asyncio
async def test_native_argv_preserves_empty_words_and_interpreter_options():
    probe = ProcessProbe(captures=("python3", EXTERNAL_COMMANDS))
    async with workspace({"/work": RAMResource()},
                         mode=MountMode.EXEC,
                         runtimes=[probe]) as ws:
        await ws.execute("cd /work")
        result = await ws.execute(
            "TOKEN=one python3 -c 'print(1)' -u 'a b' '$(echo literal)' ''")
        assert result.exit_code == 0
        request = probe.requests[0]
        assert request.argv == ("python3", "-c", "print(1)", "-u", "a b",
                                "$(echo literal)", "")
        assert request.cwd.virtual == "/work"
        assert request.env["TOKEN"] == "one"
        await ws.execute("native-tool")
        assert "TOKEN" not in probe.requests[1].env


@pytest.mark.asyncio
async def test_external_globs_expand_against_the_workspace():
    probe = ProcessProbe()
    async with workspace({"/work": RAMResource()},
                         mode=MountMode.EXEC,
                         runtimes=[probe]) as ws:
        await ws.execute("touch /work/a.txt /work/b.txt")
        result = await ws.execute("native-tool /work/*.txt '/work/*.txt'")
        assert result.exit_code == 0
        assert probe.requests[0].argv == ("native-tool", "/work/a.txt",
                                          "/work/b.txt", "/work/*.txt")


@pytest.mark.asyncio
async def test_runtime_refusal_cannot_fall_through_to_external_capture():
    named = ProcessProbe(captures=("native-tool", ), script=lambda ctx: False)
    fallback = ProcessProbe()
    fallback.name = "fallback"
    async with workspace({"/": RAMResource()}, runtimes=[named,
                                                         fallback]) as ws:
        assert (await ws.execute("native-tool")).exit_code == 126
        assert not named.requests and not fallback.requests
        assert (await ws.execute("another-tool")).exit_code == 0
        assert len(fallback.requests) == 1


@pytest.mark.asyncio
async def test_refused_external_fallback_leaves_mirage_available():
    probe = ProcessProbe(script=lambda ctx: False)
    async with workspace({"/": RAMResource()}, runtimes=[probe]) as ws:
        assert (await ws.execute("native-tool")).exit_code == 126
        assert await (await
                      ws.execute("echo mirage")).stdout_str() == "mirage\n"
        assert not probe.requests


@pytest.mark.asyncio
async def test_shell_function_precedes_external_and_discovery_names_the_route(
):
    probe = ProcessProbe()
    async with workspace({"/": RAMResource()}, runtimes=[probe]) as ws:
        assert await (
            await
            ws.execute("type -t native-tool")).stdout_str() == "external\n"
        await ws.execute("native-tool() { echo function; }")
        assert await (await
                      ws.execute("native-tool")).stdout_str() == "function\n"
        assert not probe.requests


@pytest.mark.parametrize(
    "entry",
    ["- name: sandlock", '- name: sandlock\n  captures: ["@external"]'])
def test_yaml_external_capture_matches_the_sdk_default(entry):
    entries = _build_runtime_entries(yaml.safe_load(entry))
    assert entries[0].captures == (EXTERNAL_COMMANDS, )
