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
from collections.abc import AsyncIterator

from mirage.commands.builtin.ram import cat as ram_cat
from mirage.resource.ram import RAMResource
from mirage.types import MountMode, PathSpec
from mirage.workspace import Workspace


def _spying_stream(real_stream, pulled: list[str]):

    def factory(accessor, p: PathSpec) -> AsyncIterator[bytes]:
        return _spy_iter(real_stream(accessor, p), p.original, pulled)

    return factory


async def _spy_iter(source: AsyncIterator[bytes], name: str,
                    pulled: list[str]) -> AsyncIterator[bytes]:
    first = True
    async for chunk in source:
        if first:
            pulled.append(name)
            first = False
        yield chunk


def _seeded_ws() -> Workspace:
    ws = Workspace({"/data": RAMResource()}, mode=MountMode.WRITE)

    async def seed():
        await ws.execute("tee /data/a.txt > /dev/null", stdin=b"a1\na2\na3\n")
        await ws.execute("tee /data/b.txt > /dev/null", stdin=b"b1\nb2\n")

    asyncio.run(seed())
    return ws


def test_multi_cat_head_skips_second_file(monkeypatch):
    ws = _seeded_ws()
    pulled: list[str] = []
    cmd_globals = ram_cat.__wrapped__.__globals__
    monkeypatch.setitem(cmd_globals, "_stream_core",
                        _spying_stream(cmd_globals["_stream_core"], pulled))

    async def run():
        result = await ws.execute("cat /data/a.txt /data/b.txt | head -n 1")
        assert await result.stdout_str() == "a1\n"
        await ws.close()

    asyncio.run(run())
    assert pulled == ["/data/a.txt"]


def test_multi_cat_full_reads_both_files(monkeypatch):
    ws = _seeded_ws()
    pulled: list[str] = []
    cmd_globals = ram_cat.__wrapped__.__globals__
    monkeypatch.setitem(cmd_globals, "_stream_core",
                        _spying_stream(cmd_globals["_stream_core"], pulled))

    async def run():
        result = await ws.execute("cat /data/a.txt /data/b.txt")
        assert await result.stdout_str() == "a1\na2\na3\nb1\nb2\n"
        await ws.close()

    asyncio.run(run())
    assert pulled == ["/data/a.txt", "/data/b.txt"]
