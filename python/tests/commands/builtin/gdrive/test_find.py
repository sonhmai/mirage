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
from unittest.mock import AsyncMock, patch

import pytest

from mirage.accessor.gdrive import GDriveAccessor
from mirage.cache.index.config import IndexEntry
from mirage.cache.index.ram import RAMIndexCacheStore
from mirage.commands.builtin.gdrive.find import find
from mirage.core.google._client import TokenManager
from mirage.core.google.config import GoogleConfig
from mirage.types import PathSpec


@pytest.fixture
def config():
    return GoogleConfig(
        client_id="test-id",
        client_secret="test-secret",
        refresh_token="test-refresh",
    )


@pytest.fixture
def token_manager(config):
    mgr = TokenManager(config)
    mgr._access_token = "fake-token"
    mgr._expires_at = 9999999999
    return mgr


@pytest.fixture
def accessor(config, token_manager):
    return GDriveAccessor(config=config, token_manager=token_manager)


@pytest.fixture
def index():
    return RAMIndexCacheStore()


def _dir_spec(path: str, prefix: str = "") -> PathSpec:
    return PathSpec(original=path,
                    directory=path,
                    resolved=False,
                    prefix=prefix)


def _entry(eid: str,
           name: str,
           resource_type: str,
           size: int | None = None,
           modified: str = "") -> IndexEntry:
    return IndexEntry(
        id=eid,
        name=name,
        resource_type=resource_type,
        remote_time=modified,
        vfs_name=name,
        size=size,
    )


def _recent() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()


def _old() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()


async def _populate_warm(index: RAMIndexCacheStore, prefix: str = "") -> None:
    root = prefix or "/"
    await index.set_dir(root, [
        ("docs", _entry(
            "fid-docs", "docs", "gdrive/folder", modified=_recent())),
        ("file.txt",
         _entry("fid-file",
                "file.txt",
                "gdrive/file",
                size=2048,
                modified=_recent())),
        ("doc.gdoc.json",
         _entry("fid-gdoc", "doc.gdoc.json", "gdrive/gdoc", size=None)),
    ])
    await index.set_dir(f"{prefix}/docs", [
        ("inner.txt",
         _entry(
             "fid-inner", "inner.txt", "gdrive/file", size=10,
             modified=_old())),
    ])


def _lines(output: bytes) -> list[str]:
    return output.decode().splitlines()


@pytest.mark.asyncio
async def test_find_warm_cache_recurses_into_directories(accessor, index):
    await _populate_warm(index)
    result, io = await find(accessor, [_dir_spec("/")], index=index)
    lines = _lines(result)
    assert "/docs/inner.txt" in lines
    assert "/docs" in lines
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_find_warm_cache_no_trailing_slash(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], index=index)
    assert all(not line.endswith("/") for line in _lines(result))


@pytest.mark.asyncio
async def test_find_cold_name_matches_directory(accessor, index):
    files_by_folder = {
        "root": [
            {
                "id": "fid-docs",
                "name": "docs",
                "mimeType": "application/vnd.google-apps.folder",
                "modifiedTime": "2026-01-01T00:00:00Z",
            },
            {
                "id": "fid-file",
                "name": "file.txt",
                "mimeType": "text/plain",
                "modifiedTime": "2026-01-02T00:00:00Z",
                "size": "2048",
            },
            {
                "id": "fid-gdoc",
                "name": "doc",
                "mimeType": "application/vnd.google-apps.document",
                "modifiedTime": "2026-01-03T00:00:00Z",
            },
        ],
        "fid-docs": [
            {
                "id": "fid-inner",
                "name": "inner.txt",
                "mimeType": "text/plain",
                "modifiedTime": "2026-01-04T00:00:00Z",
                "size": "10",
            },
        ],
    }

    async def fake_list_files(token_manager, folder_id="root"):
        return files_by_folder.get(folder_id, [])

    with patch(
            "mirage.core.gdrive.readdir.list_files",
            new=AsyncMock(side_effect=fake_list_files),
    ):
        result, _ = await find(accessor, [_dir_spec("/")],
                               name="docs",
                               index=index)
        assert _lines(result) == ["/docs"]


@pytest.mark.asyncio
async def test_find_cold_output_has_no_trailing_slash(accessor, index):

    async def fake_list_files(token_manager, folder_id="root"):
        if folder_id == "root":
            return [{
                "id": "fid-docs",
                "name": "docs",
                "mimeType": "application/vnd.google-apps.folder",
                "modifiedTime": "2026-01-01T00:00:00Z",
            }]
        return []

    with patch(
            "mirage.core.gdrive.readdir.list_files",
            new=AsyncMock(side_effect=fake_list_files),
    ):
        result, _ = await find(accessor, [_dir_spec("/")], index=index)
        assert _lines(result) == ["/docs"]


@pytest.mark.asyncio
async def test_find_type_f(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="f", index=index)
    assert _lines(result) == ["/doc.gdoc.json", "/docs/inner.txt", "/file.txt"]


@pytest.mark.asyncio
async def test_find_type_d(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], type="d", index=index)
    assert _lines(result) == ["/docs"]


@pytest.mark.asyncio
async def test_find_size_min(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], size="+1k", index=index)
    assert "/file.txt" in _lines(result)
    assert "/docs/inner.txt" not in _lines(result)
    assert "/doc.gdoc.json" not in _lines(result)


@pytest.mark.asyncio
async def test_find_size_max_treats_none_as_zero(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           size="-100c",
                           index=index)
    lines = _lines(result)
    assert "/docs/inner.txt" in lines
    assert "/doc.gdoc.json" in lines
    assert "/file.txt" not in lines


@pytest.mark.asyncio
async def test_find_mtime_recent(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], mtime="-1", index=index)
    lines = _lines(result)
    assert "/file.txt" in lines
    assert "/docs" in lines
    assert "/docs/inner.txt" not in lines
    assert "/doc.gdoc.json" not in lines


@pytest.mark.asyncio
async def test_find_mtime_old(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")], mtime="+5", index=index)
    assert _lines(result) == ["/docs/inner.txt"]


@pytest.mark.asyncio
async def test_find_path_pattern_strips_mount_prefix(accessor, index):
    await _populate_warm(index, prefix="/gd")
    result, _ = await find(accessor, [_dir_spec("/gd", prefix="/gd")],
                           path="/docs/*",
                           index=index)
    assert _lines(result) == ["/gd/docs/inner.txt"]


@pytest.mark.asyncio
async def test_find_name_matches_native_gdoc(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           name="*.gdoc.json",
                           index=index)
    assert _lines(result) == ["/doc.gdoc.json"]


@pytest.mark.asyncio
async def test_find_maxdepth_limits_recursion(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           maxdepth="1",
                           index=index)
    assert _lines(result) == ["/doc.gdoc.json", "/docs", "/file.txt"]


@pytest.mark.asyncio
async def test_find_maxdepth_zero_lists_nothing(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           maxdepth="0",
                           index=index)
    assert _lines(result) == []


@pytest.mark.asyncio
async def test_find_mindepth_one_keeps_top_level(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           mindepth="1",
                           index=index)
    assert _lines(result) == [
        "/doc.gdoc.json", "/docs", "/docs/inner.txt", "/file.txt"
    ]


@pytest.mark.asyncio
async def test_find_mindepth_skips_top_level(accessor, index):
    await _populate_warm(index)
    result, _ = await find(accessor, [_dir_spec("/")],
                           mindepth="2",
                           index=index)
    assert _lines(result) == ["/docs/inner.txt"]
