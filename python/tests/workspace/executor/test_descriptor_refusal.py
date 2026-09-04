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

import pytest

from mirage import MountMode, RAMResource, Workspace


async def _ws() -> Workspace:
    ws = Workspace({"/": RAMResource()}, mode=MountMode.WRITE)
    await ws.execute("mkdir -p /data; printf a > /data/a.txt")
    return ws


@pytest.mark.asyncio
@pytest.mark.parametrize("line", [
    "echo x 3>/data/f",
    "echo x >&3",
    "echo x 2>&3",
    "cat <&3",
    "exec 3>/data/g",
    "exec 3>&-",
])
async def test_descriptor_above_two_is_refused_and_touches_nothing(line):
    ws = await _ws()
    io = await ws.execute(f"{line}; echo code=$?")
    assert await io.stderr_str() == "3: Bad file descriptor\n"
    assert await io.stdout_str() == "code=1\n"
    listing = await ws.execute("ls /data")
    assert await listing.stdout_str() == "a.txt\n"


@pytest.mark.asyncio
async def test_bad_descriptor_short_circuits_like_a_shell_error():
    ws = await _ws()
    io = await ws.execute("echo x >&3 && echo and || echo or")
    assert await io.stdout_str() == "or\n"


@pytest.mark.asyncio
async def test_exec_redirect_refusal_leaves_the_shell_streams_alone():
    ws = await _ws()
    ws.create_session("s")
    await ws.execute("exec 3>&-", session_id="s")
    io = await ws.execute("echo still", session_id="s")
    assert await io.stdout_str() == "still\n"


@pytest.mark.asyncio
async def test_closed_stdout_drops_output_and_reports_the_write():
    ws = await _ws()
    io = await ws.execute("echo x >&-; echo code=$?")
    assert await io.stdout_str() == "code=1\n"
    assert await io.stderr_str() == "echo: write error: Bad file descriptor\n"


@pytest.mark.asyncio
async def test_closed_stderr_and_stdin_are_quiet():
    ws = await _ws()
    io = await ws.execute("echo x 2>&-; echo code=$?")
    assert await io.stdout_str() == "x\ncode=0\n"
    io = await ws.execute("cat /data/a.txt <&-; echo code=$?")
    assert await io.stdout_str() == "acode=0\n"


@pytest.mark.asyncio
async def test_a_numeric_target_is_routed_by_the_claimed_descriptor():
    ws = await _ws()
    io = await ws.execute("cat /data/missing 2<&-; echo code=$?")
    assert await io.stdout_str() == "code=1\n"
    assert await io.stderr_str() == ""
    io = await ws.execute("echo x 1<&-; echo code=$?")
    assert await io.stdout_str() == "code=1\n"
    assert await io.stderr_str() == "echo: write error: Bad file descriptor\n"
    io = await ws.execute("cat /data/missing 2<&1; echo code=$?")
    assert await io.stdout_str() == (
        "cat: /data/missing: No such file or directory\ncode=1\n")
    assert await io.stderr_str() == ""


@pytest.mark.asyncio
async def test_a_bare_zero_before_the_operator_is_the_descriptor():
    ws = await _ws()
    io = await ws.execute("echo x 0>&-; echo code=$?")
    assert await io.stdout_str() == "x\ncode=0\n"
    io = await ws.execute("cat 0</data/a.txt; echo code=$?")
    assert await io.stdout_str() == "acode=0\n"
    io = await ws.execute("echo 0 >&-; echo code=$?")
    assert await io.stdout_str() == "code=1\n"
    assert await io.stderr_str() == "echo: write error: Bad file descriptor\n"


@pytest.mark.asyncio
async def test_exec_closes_by_the_claimed_descriptor():
    ws = await _ws()
    io = await ws.execute("exec 2<&-; cat /data/missing; echo code=$?")
    assert await io.stdout_str() == "code=1\n"
    assert await io.stderr_str() == ""
    io = await ws.execute("exec 0>&-; echo x; echo code=$?")
    assert await io.stdout_str() == "x\ncode=0\n"


@pytest.mark.asyncio
async def test_self_dups_change_nothing():
    ws = await _ws()
    io = await ws.execute("echo x 1>&1; echo y 2>&2; cat <&0 </data/a.txt")
    assert await io.stdout_str() == "x\ny\na"
