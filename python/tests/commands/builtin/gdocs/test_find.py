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

from datetime import datetime, timedelta, timezone

import pytest

from mirage.accessor.gdocs import GDocsAccessor
from mirage.cache.index import IndexEntry
from mirage.cache.index.ram import RAMIndexCacheStore
from mirage.commands.builtin.gdocs.find import find
from mirage.types import PathSpec


@pytest.fixture
def accessor():
    return GDocsAccessor(config=None, token_manager=None)


@pytest.fixture
def index():
    return RAMIndexCacheStore()


def _dir_spec(path: str, prefix: str = "") -> PathSpec:
    return PathSpec(original=path,
                    directory=path,
                    resolved=False,
                    prefix=prefix)


def _lines(output: bytes) -> list[str]:
    return output.decode().splitlines()


async def _populate(index: RAMIndexCacheStore) -> None:
    recent = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    await index.set_dir("/owned", [
        ("Doc_A__d1.gdoc.json",
         IndexEntry(id="d1",
                    name="Doc A",
                    resource_type="gdocs/file",
                    remote_time=recent,
                    vfs_name="Doc_A__d1.gdoc.json",
                    size=None)),
        ("Big__d2.gdoc.json",
         IndexEntry(id="d2",
                    name="Big",
                    resource_type="gdocs/file",
                    remote_time=old,
                    vfs_name="Big__d2.gdoc.json",
                    size=2048)),
    ])
    await index.set_dir("/shared", [])


@pytest.mark.asyncio
async def test_find_type_f(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="f", index=index)
    assert _lines(result) == [
        "/owned/Big__d2.gdoc.json", "/owned/Doc_A__d1.gdoc.json"
    ]


@pytest.mark.asyncio
async def test_find_type_d(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="d", index=index)
    assert _lines(result) == ["/owned", "/shared"]


@pytest.mark.asyncio
async def test_find_size_treats_none_as_zero(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], size="+1k", index=index)
    lines = _lines(result)
    assert "/owned/Big__d2.gdoc.json" in lines
    assert "/owned/Doc_A__d1.gdoc.json" not in lines


@pytest.mark.asyncio
async def test_find_mtime_recent(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], mtime="-1", index=index)
    assert _lines(result) == ["/owned/Doc_A__d1.gdoc.json"]


@pytest.mark.asyncio
async def test_find_path_pattern(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           path="/owned/*",
                           index=index)
    assert _lines(result) == [
        "/owned/Big__d2.gdoc.json", "/owned/Doc_A__d1.gdoc.json"
    ]
