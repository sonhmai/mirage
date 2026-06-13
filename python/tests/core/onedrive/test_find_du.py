import pytest
from aioresponses import aioresponses

from mirage.accessor.onedrive import OneDriveAccessor, OneDriveConfig
from mirage.core.onedrive.du import du, du_all
from mirage.core.onedrive.find import find
from mirage.types import PathSpec


def _accessor(**kw) -> OneDriveAccessor:
    return OneDriveAccessor(OneDriveConfig(access_token="tok", **kw))


_BASE = "https://graph.microsoft.com/v1.0/me/drive"


def _tree(m):
    m.get(_BASE + "/root/children",
          payload={
              "value": [
                  {
                      "id": "1",
                      "name": "a.txt",
                      "size": 3,
                      "file": {}
                  },
                  {
                      "id": "2",
                      "name": "sub",
                      "folder": {
                          "childCount": 1
                      }
                  },
              ]
          })
    m.get(_BASE + "/root:/sub:/children",
          payload={
              "value": [{
                  "id": "3",
                  "name": "b.txt",
                  "size": 5,
                  "file": {}
              }]
          })


@pytest.mark.asyncio
async def test_du_sums_all_files_recursively():
    with aioresponses() as m:
        _tree(m)
        total = await du(_accessor(), PathSpec.from_str_path("/"))
    assert total == 8


@pytest.mark.asyncio
async def test_du_all_lists_files_plus_total():
    with aioresponses() as m:
        _tree(m)
        rows = await du_all(_accessor(), PathSpec.from_str_path("/"))
    assert ("/a.txt", 3) in rows
    assert ("/sub/b.txt", 5) in rows
    assert rows[-1][1] == 8


@pytest.mark.asyncio
async def test_find_returns_files_and_folders():
    with aioresponses() as m:
        _tree(m)
        out = await find(_accessor(), PathSpec.from_str_path("/"))
    assert out == ["/a.txt", "/sub", "/sub/b.txt"]


@pytest.mark.asyncio
async def test_find_type_file_excludes_folders():
    with aioresponses() as m:
        _tree(m)
        out = await find(_accessor(), PathSpec.from_str_path("/"), type="file")
    assert out == ["/a.txt", "/sub/b.txt"]


@pytest.mark.asyncio
async def test_find_name_glob():
    with aioresponses() as m:
        _tree(m)
        out = await find(_accessor(), PathSpec.from_str_path("/"), name="b.*")
    assert out == ["/sub/b.txt"]
