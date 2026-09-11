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

from mirage.commands.cli.builtin.git.io import (blocking_ancestor, read_file,
                                                read_names, read_optional,
                                                remove_tree)
from mirage.types import FileStat, FileType


@pytest.mark.asyncio
async def test_read_file_returns_bytes(workspace):
    data = await read_file(workspace.dispatch, "/repo/a.txt")
    assert data == b"one changed\n"


@pytest.mark.asyncio
async def test_read_file_propagates_a_miss(workspace):
    with pytest.raises(FileNotFoundError):
        await read_file(workspace.dispatch, "/repo/nope.txt")


@pytest.mark.asyncio
async def test_read_optional_answers_none_for_a_miss(workspace):
    # packed-refs is absent from a perfectly valid repository, so a miss
    # is an answer rather than an error.
    assert await read_optional(workspace.dispatch, "/repo/nope.txt") is None


@pytest.mark.asyncio
async def test_read_optional_returns_content_when_present(workspace):
    assert await read_optional(workspace.dispatch,
                               "/repo/a.txt") == b"one changed\n"


@pytest.mark.asyncio
async def test_read_names_lists_a_directory(workspace):
    names = await read_names(workspace.dispatch, "/repo")
    assert any(n.rstrip("/").rsplit("/", 1)[-1] == "a.txt" for n in names)


@pytest.mark.asyncio
async def test_read_names_is_empty_for_a_missing_directory(workspace):
    assert await read_names(workspace.dispatch, "/repo/nodir") == []


class Links:
    """A link view holding one link, at ``/repo/slot``."""

    def stat_at(self, path: str) -> FileStat | None:
        """What the namespace holds at a path, None when no link.

        Args:
            path (str): absolute virtual path.
        """
        if path != "/repo/slot":
            return None
        return FileStat(name="slot", type=FileType.SYMLINK)


async def only_dirs(path: str) -> FileStat | None:
    """A data plane in which every component is a directory.

    Args:
        path (str): absolute virtual path.
    """
    return FileStat(name=path.rsplit("/", 1)[-1], type=FileType.DIRECTORY)


async def file_at_slot(path: str) -> FileStat | None:
    """A data plane holding a regular file at ``/repo/slot``.

    Args:
        path (str): absolute virtual path.
    """
    kind = FileType.FILE if path == "/repo/slot" else FileType.DIRECTORY
    return FileStat(name=path.rsplit("/", 1)[-1], type=kind)


@pytest.mark.asyncio
async def test_a_link_above_the_entry_is_found():
    found = await blocking_ancestor(only_dirs, "/repo", "slot/child", Links())
    assert found == "/repo/slot"
    # The component itself is not an ancestor of itself, and a path with
    # nothing but directories above it has none.
    assert await blocking_ancestor(only_dirs, "/repo", "slot", Links()) is None
    assert await blocking_ancestor(only_dirs, "/repo", "other/child",
                                   Links()) is None


@pytest.mark.asyncio
async def test_a_regular_file_above_the_entry_is_found_too():
    # No link anywhere: what is in the way is an ordinary file, which
    # only the data plane can report.
    found = await blocking_ancestor(file_at_slot, "/repo", "slot/child", None)
    assert found == "/repo/slot"
    assert await blocking_ancestor(only_dirs, "/repo", "slot/child",
                                   None) is None


@pytest.mark.asyncio
async def test_the_namespace_is_asked_before_the_data_plane():
    # stat_path dereferences, so a link to a directory stats as a
    # directory: asking it first would walk straight through the link.
    found = await blocking_ancestor(only_dirs, "/repo", "slot/deep/child",
                                    Links())
    assert found == "/repo/slot"


class TreeLinks:
    """A link view holding one link, at ``/repo/slot/link``."""

    def stat_at(self, path: str) -> FileStat | None:
        """What the namespace holds at a path, None when no link.

        Args:
            path (str): absolute virtual path.
        """
        if path != "/repo/slot/link":
            return None
        return FileStat(name="link", type=FileType.SYMLINK)


class Recorder:
    """A dispatcher that lists one link and records every op it is asked for.

    ``readdir`` answers through the link the way the real one does: the
    name plane owns links, so the data plane resolves the path and
    lists what it points at.
    """

    def __init__(self) -> None:
        self.ops: list[tuple[str, str]] = []

    async def __call__(self, op: str, path, **kwargs):
        """Record one op and answer the listings.

        Args:
            op (str): the op name.
            path (PathSpec): the path it is asked for.
            **kwargs (object): ignored.
        """
        where = path.virtual
        self.ops.append((op, where))
        if op == "readdir":
            if where == "/repo/slot":
                return ["/repo/slot/link"], None
            if where == "/repo/slot/link":
                return ["/repo/outside/keep.txt"], None
            return [], None
        if op == "rmdir" and where != "/repo/slot":
            raise NotADirectoryError(where)
        return None, None


@pytest.mark.asyncio
async def test_removing_a_tree_unlinks_a_link_without_descending():
    calls = Recorder()
    await remove_tree(calls, "/repo/slot", TreeLinks())
    assert ("unlink", "/repo/slot/link") in calls.ops
    # The whole point: readdir dereferences, so listing the link at all
    # is the walk stepping outside the directory being replaced.
    assert ("readdir", "/repo/slot/link") not in calls.ops
    assert not any(
        where.startswith("/repo/outside") for _op, where in calls.ops)


@pytest.mark.asyncio
async def test_without_a_namespace_the_walk_has_nothing_to_ask():
    # Outside a workspace there is no name plane, so a link cannot be
    # told from a directory and the walk is the old one.
    calls = Recorder()
    await remove_tree(calls, "/repo/slot", None)
    assert ("readdir", "/repo/slot/link") in calls.ops
