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

from mirage.accessor.gsheets import GSheetsAccessor
from mirage.cache.index import IndexEntry
from mirage.cache.index.ram import RAMIndexCacheStore
from mirage.commands.builtin.gsheets.find import find
from mirage.types import PathSpec


@pytest.fixture
def accessor():
    return GSheetsAccessor(config=None, token_manager=None)


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
    await index.set_dir("/owned", [
        ("Sheet_A__s1.gsheet.json",
         IndexEntry(id="s1",
                    name="Sheet A",
                    resource_type="gsheets/file",
                    vfs_name="Sheet_A__s1.gsheet.json",
                    size=None)),
    ])
    await index.set_dir("/shared", [])


@pytest.mark.asyncio
async def test_find_type_f(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="f", index=index)
    assert _lines(result) == ["/owned/Sheet_A__s1.gsheet.json"]


@pytest.mark.asyncio
async def test_find_type_d(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="d", index=index)
    assert _lines(result) == ["/owned", "/shared"]
