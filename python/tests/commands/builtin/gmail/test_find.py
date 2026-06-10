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

from mirage.accessor.gmail import GmailAccessor
from mirage.cache.index import IndexEntry
from mirage.cache.index.ram import RAMIndexCacheStore
from mirage.commands.builtin.gmail.find import find
from mirage.types import PathSpec


@pytest.fixture
def accessor():
    return GmailAccessor(config=None, token_manager=None)


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
    await index.set_dir("/", [
        ("INBOX",
         IndexEntry(id="INBOX",
                    name="INBOX",
                    resource_type="gmail/label",
                    vfs_name="INBOX")),
    ])
    await index.set_dir("/INBOX", [
        ("2026-06-01",
         IndexEntry(id="2026-06-01",
                    name="2026-06-01",
                    resource_type="gmail/date",
                    vfs_name="2026-06-01")),
    ])
    await index.set_dir("/INBOX/2026-06-01", [
        ("Hello__m1.gmail.json",
         IndexEntry(id="m1",
                    name="Hello",
                    resource_type="gmail/message",
                    vfs_name="Hello__m1.gmail.json",
                    size=123)),
    ])


@pytest.mark.asyncio
async def test_find_type_f(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="f", index=index)
    assert _lines(result) == ["/INBOX/2026-06-01/Hello__m1.gmail.json"]


@pytest.mark.asyncio
async def test_find_type_d(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="d", index=index)
    assert _lines(result) == ["/INBOX", "/INBOX/2026-06-01"]


@pytest.mark.asyncio
async def test_find_name_matches_message(accessor, index):
    await _populate(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           name="*.gmail.json",
                           index=index)
    assert _lines(result) == ["/INBOX/2026-06-01/Hello__m1.gmail.json"]
