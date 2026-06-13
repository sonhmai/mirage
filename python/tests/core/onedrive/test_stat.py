import pytest
from aioresponses import aioresponses

from mirage.accessor.onedrive import OneDriveAccessor, OneDriveConfig
from mirage.core.onedrive.stat import stat
from mirage.types import FileType, PathSpec


def _accessor(**kw) -> OneDriveAccessor:
    return OneDriveAccessor(OneDriveConfig(access_token="tok", **kw))


_FILE_URL = ("https://graph.microsoft.com/v1.0/me/drive"
             "/root:/Docs/report.docx")
_DIR_URL = "https://graph.microsoft.com/v1.0/me/drive/root:/Docs"


@pytest.mark.asyncio
async def test_stat_root_is_directory():
    result = await stat(_accessor(), PathSpec.from_str_path("/"))
    assert result.type == FileType.DIRECTORY


@pytest.mark.asyncio
async def test_stat_file_carries_size_and_ctag_fingerprint():
    with aioresponses() as m:
        m.get(_FILE_URL,
              payload={
                  "id": "01ITEM",
                  "name": "report.docx",
                  "size": 1234,
                  "lastModifiedDateTime": "2026-05-01T10:00:00Z",
                  "cTag": "ctag-abc",
                  "eTag": "etag-xyz",
                  "file": {
                      "mimeType": "application/vnd.openxml"
                  },
              })
        result = await stat(_accessor(),
                            PathSpec.from_str_path("/Docs/report.docx"))
    assert result.name == "report.docx"
    assert result.size == 1234
    assert result.fingerprint == "ctag-abc"
    assert result.extra["id"] == "01ITEM"


@pytest.mark.asyncio
async def test_stat_folder_is_directory():
    with aioresponses() as m:
        m.get(_DIR_URL,
              payload={
                  "id": "01FOLDER",
                  "name": "Docs",
                  "folder": {
                      "childCount": 2
                  },
              })
        result = await stat(_accessor(), PathSpec.from_str_path("/Docs"))
    assert result.type == FileType.DIRECTORY
    assert result.name == "Docs"


@pytest.mark.asyncio
async def test_stat_missing_raises_file_not_found():
    with aioresponses() as m:
        m.get(_FILE_URL,
              status=404,
              payload={"error": {
                  "code": "itemNotFound",
                  "message": "no"
              }})
        with pytest.raises(FileNotFoundError):
            await stat(_accessor(),
                       PathSpec.from_str_path("/Docs/report.docx"))
