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

import asyncio

import pytest

from mirage.commands.cli.types import CLISpec
from mirage.io import IOResult
from mirage.resource.ram import RAMResource
from mirage.runtime.base import Runtime
from mirage.shell.console import Channel
from mirage.shell.job_table import JobStatus
from mirage.types import MountMode, PathSpec
from mirage.workspace import Workspace
from mirage.workspace.types import ExecutionNode

_RELEASE: list[asyncio.Event] = []


@pytest.mark.asyncio
async def test_retired_command_cannot_cache_bytes_for_replacement_mount():

    class CachedRAM(RAMResource):
        caches_reads = True

    old = CachedRAM()
    old.load_state({"files": {"/file": b"old"}})
    replacement = CachedRAM()
    replacement.load_state({"files": {"/file": b"new"}})
    entered = asyncio.Event()
    release = asyncio.Event()

    async def gate(_inv):
        entered.set()
        await release.wait()
        return None, IOResult()

    ws = Workspace({"/data": old})
    ws.register_cli("gate", CLISpec(name="gate", fn=gate))
    retired = ws.mount("/data").cache_manager
    running = asyncio.create_task(ws.execute("cat /data/file; gate"))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        await ws.unmount("/data")
        ws.add_mount("/data", replacement)
        release.set()
        result = await asyncio.wait_for(running, timeout=5)
        assert result.stdout == b"old"
        assert await ws.cache.get("/data/file") is None
        assert (await ws.execute("cat /data/file")).stdout == b"new"
        assert await ws.cache.get("/data/file") == b"new"
        assert retired is not None
        assert await retired.cached_bytes(
            PathSpec(virtual="/data/file",
                     directory="/data/",
                     resource_path="file")) is None
    finally:
        release.set()
        await asyncio.gather(running, return_exceptions=True)
        await ws.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_eviction", [False, True])
async def test_unmount_keeps_prefix_reserved_until_cache_cleanup(
        monkeypatch, fail_eviction):
    resource = RAMResource()
    ws = Workspace({"/data": resource})
    cache = ws.cache
    entered = asyncio.Event()
    release = asyncio.Event()
    evict = cache.evict_prefix

    async def blocked_evict(prefix):
        entered.set()
        await release.wait()
        if fail_eviction:
            raise RuntimeError("cache unavailable")
        await evict(prefix)

    monkeypatch.setattr(cache, "evict_prefix", blocked_evict)
    await cache.set("/data", b"root")
    await cache.set("/data/file", b"old")
    await cache.set("/database/file", b"peer")
    removing = asyncio.create_task(ws.unmount("data/"))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        with pytest.raises(ValueError, match="duplicate mount prefix"):
            ws.add_mount("/data", RAMResource())
        release.set()
        if fail_eviction:
            with pytest.raises(RuntimeError, match="cache unavailable"):
                await removing
            assert ws.mount("/data").resource is resource
            monkeypatch.setattr(cache, "evict_prefix", evict)
            await ws.unmount("/data")
        else:
            await removing
        assert await cache.get("/data") is None
        assert await cache.get("/data/file") is None
        assert await cache.get("/database/file") == b"peer"
        ws.add_mount("/data", RAMResource())
    finally:
        release.set()
        await asyncio.gather(removing, return_exceptions=True)
        await ws.close()


def _workspace() -> Workspace:
    return Workspace({"/m": (RAMResource(), MountMode.WRITE)},
                     mode=MountMode.WRITE)


async def _deaf_run(job):
    """A runner that swallows the cancel and keeps going.

    Deliberately not ``sleep``: that is the one command which consumes
    the signal, so it settles through its own runner and would pass even
    when teardown merely requests a cancel. Only settling in teardown
    ends this one.

    Args:
        job: the job being run, whose console proves it started.
    """
    await job.console.emit(Channel.STDOUT, b"partial")
    release = asyncio.Event()
    _RELEASE.append(release)
    try:
        await asyncio.sleep(30)
    except asyncio.CancelledError:
        await release.wait()
    return IOResult(exit_code=0), ExecutionNode(command="deaf", exit_code=0)


async def _submit_deaf(ws: Workspace):
    """Start a deaf job and return it once it is genuinely running.

    Args:
        ws (Workspace): workspace whose table receives the job.
    """
    job = ws.job_table.submit(command="deaf", run=_deaf_run, cwd="/")
    while not await job.console.snapshot(Channel.STDOUT):
        await asyncio.sleep(0)
    return job


@pytest.mark.asyncio
async def test_close_settles_a_job_that_ignores_the_cancel():
    """Teardown records the outcome, it does not only request a cancel.

    A bare cancel leaves the job RUNNING with no ending chunk, so anyone
    parked on ``wait_finished`` waits forever on a workspace that is
    already gone. ``kill_all`` never joins the runner, so settling here
    cannot block shutdown on a job that is mid-write.
    """
    _RELEASE.clear()
    ws = _workspace()
    job = await _submit_deaf(ws)
    try:
        await asyncio.wait_for(ws.close(), timeout=5)

        assert job.status == JobStatus.KILLED
        assert job.exit_code == 137
        await asyncio.wait_for(job.console.wait_finished(), timeout=2)
    finally:
        # Unconditional: a failed assertion above must still unblock the
        # runner, or the pending task turns a clean failure into a hang
        # at loop teardown.
        for release in _RELEASE:
            release.set()
        await asyncio.sleep(0)

    # The runner unwinding afterwards must not reopen or relabel it.
    assert job.status == JobStatus.KILLED


@pytest.mark.asyncio
async def test_close_is_idempotent_with_a_job_running():
    _RELEASE.clear()
    ws = _workspace()
    job = await _submit_deaf(ws)
    try:
        await asyncio.wait_for(ws.close(), timeout=5)
        await asyncio.wait_for(ws.close(), timeout=5)

        assert job.status == JobStatus.KILLED
    finally:
        for release in _RELEASE:
            release.set()
        await asyncio.sleep(0)


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_phase", ["runtime", "resource"])
async def test_close_refuses_lifecycle_changes_but_allows_runtime_drain(
        monkeypatch, blocked_phase):
    entered = asyncio.Event()
    release = asyncio.Event()
    resource = RAMResource()
    ws = Workspace({"/m": (resource, MountMode.WRITE)})
    closes = []
    drained = []

    async def cli(_inv):
        return None, IOResult()

    spec = CLISpec(name="held", fn=cli)
    ws.register_cli("held", spec)

    class DrainingRuntime(Runtime):
        name = "draining"

        async def close(self):
            closes.append("runtime")
            if blocked_phase == "runtime":
                entered.set()
                await release.wait()
            await ws.fs.write("/m/journal.txt", b"drained")

    close_resource = resource.close

    async def closing_resource():
        closes.append("resource")
        if blocked_phase == "resource":
            entered.set()
            await release.wait()
        drained.append(await ws.fs.read("/m/journal.txt"))
        await close_resource()

    monkeypatch.setattr(resource, "close", closing_resource)
    runtime = DrainingRuntime()
    ws.add_runtime(runtime)
    closing = asyncio.create_task(ws.close())
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        for mutate in (
                lambda: ws.add_mount("/late", RAMResource()),
                lambda: ws.set_mount_mode("/m", MountMode.READ),
                lambda: ws.add_runtime(runtime),
                lambda: ws.register_cli("late", spec),
                lambda: ws.unregister_cli("held"),
        ):
            with pytest.raises(RuntimeError, match="Workspace is closed"):
                mutate()
        with pytest.raises(RuntimeError, match="Workspace is closed"):
            await ws.unmount("/m")
        with pytest.raises(RuntimeError, match="Workspace is closed"):
            await ws.set_session_profile(ws.default_session_id, {})
    finally:
        release.set()
        await asyncio.wait_for(asyncio.gather(closing, ws.close()), timeout=5)

    assert closes == ["runtime", "resource"]
    assert drained == [b"drained"]
