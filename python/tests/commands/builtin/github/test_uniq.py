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

from mirage.commands.builtin.github.uniq import uniq
from mirage.io.types import materialize
from mirage.types import PathSpec
from tests.fixtures.github_mock import MOCK_BLOBS


@pytest.fixture(autouse=True)
def _patch_read(monkeypatch):

    async def _read_bytes(config, owner, repo, sha):
        return MOCK_BLOBS[sha]

    monkeypatch.setattr("mirage.core.github.read.read_bytes", _read_bytes)


def _scope(path: str) -> PathSpec:
    norm = "/" + path.lstrip("/")
    directory = norm.rsplit("/", 1)[0] + "/"
    return PathSpec(original=norm, directory=directory, resolved=True)


async def _run(accessor, index, paths, **kwargs):
    stdout, io = await uniq(accessor, [_scope(p) for p in paths],
                            index=index,
                            **kwargs)
    return (await materialize(stdout)).decode(), io


@pytest.mark.asyncio
async def test_uniq_file_without_duplicates(mock_github_api, github_env):
    accessor, index = github_env
    text, _io = await _run(accessor, index, ["README.md"])
    # README.md = "# Mock Repo\n\nA test repository.\n": no adjacent dups
    assert text == "# Mock Repo\n\nA test repository.\n"


@pytest.mark.asyncio
async def test_uniq_w0_treats_all_lines_as_duplicates(mock_github_api,
                                                      github_env):
    accessor, index = github_env
    text, _io = await _run(accessor, index, ["README.md"], w="0")
    assert text == "# Mock Repo\n"


@pytest.mark.asyncio
async def test_uniq_count_from_stdin(mock_github_api, github_env):
    accessor, index = github_env
    stdout, _io = await uniq(accessor, [],
                             stdin=b"dup\ndup\nsolo\n",
                             c=True,
                             index=index)
    text = (await materialize(stdout)).decode()
    assert text == "      2 dup\n      1 solo\n"
