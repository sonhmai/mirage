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

from pathlib import Path

import pytest
from dulwich.index import ConflictedIndexEntry, Index, IndexEntry

from mirage.commands.cli.builtin.git.restore import index_tree, parse_flags
from mirage.commands.spec.types import FlagView


async def run(ws, line: str) -> tuple[int, bytes, bytes]:
    """Run one git line against the mounted repository.

    Args:
        ws (Workspace): workspace with the repository and CLI.
        line (str): the command line, without the leading directory.
    """
    result = await ws.execute(f"git -C /repo {line}")
    return result.exit_code, result.stdout or b"", result.stderr or b""


def test_the_worktree_is_the_default_target():
    parsed = parse_flags(FlagView({}))
    assert (parsed.staged, parsed.worktree) == (False, True)


def test_staged_alone_leaves_the_worktree_out():
    parsed = parse_flags(FlagView({"staged": True}))
    assert (parsed.staged, parsed.worktree) == (True, False)


def test_both_targets_can_be_named():
    parsed = parse_flags(FlagView({"staged": True, "worktree": True}))
    assert (parsed.staged, parsed.worktree) == (True, True)


def test_the_index_reads_as_a_tree():
    entry = IndexEntry(ctime=0,
                       mtime=0,
                       dev=0,
                       ino=0,
                       mode=0o100644,
                       uid=0,
                       gid=0,
                       size=3,
                       sha=b"a" * 40)
    assert index_tree({b"a.txt": entry}) == {b"a.txt": (0o100644, b"a" * 40)}


@pytest.mark.asyncio
async def test_restore_puts_an_edit_back(git_rw, repo_path: Path):
    await git_rw.execute("echo edited > /repo/a.txt")
    assert await run(git_rw, "restore a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"
    assert (await run(git_rw, "status --porcelain"))[1] == b""


@pytest.mark.asyncio
async def test_staged_unstages_and_keeps_the_edit(git_rw, repo_path: Path):
    await git_rw.execute("echo edited > /repo/a.txt")
    await run(git_rw, "add a.txt")
    assert await run(git_rw, "restore --staged a.txt") == (0, b"", b"")
    assert (await run(git_rw, "status --porcelain"))[1] == b" M a.txt\n"
    assert (repo_path / "a.txt").read_text() == "edited\n"


@pytest.mark.asyncio
async def test_both_targets_go_back_to_head(git_rw, repo_path: Path):
    await git_rw.execute("echo edited > /repo/a.txt")
    await run(git_rw, "add a.txt")
    await git_rw.execute("echo again > /repo/a.txt")
    assert await run(git_rw, "restore -SW a.txt") == (0, b"", b"")
    assert (await run(git_rw, "status --porcelain"))[1] == b""
    assert (repo_path / "a.txt").read_text() == "one changed\n"


@pytest.mark.asyncio
async def test_an_unknown_path_is_an_error_not_a_fatal(git_rw):
    code, _out, err = await run(git_rw, "restore nosuch")
    assert code == 1
    assert err == (b"error: pathspec 'nosuch' did not match any file(s) "
                   b"known to git\n")


@pytest.mark.asyncio
async def test_no_pathspec_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "restore")
    assert code == 128
    assert err == b"fatal: you must specify path(s) to restore\n"


@pytest.mark.asyncio
async def test_a_source_restores_from_that_tree(git_rw, repo_path: Path):
    assert await run(git_rw, "restore --source HEAD~1 a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one\n"
    assert (await run(git_rw, "status --porcelain"))[1] == b" M a.txt\n"


@pytest.mark.asyncio
async def test_a_bad_source_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "restore -s nosuch a.txt")
    assert code == 128
    assert err == b"fatal: could not resolve nosuch\n"


@pytest.mark.asyncio
async def test_staged_turns_a_new_file_back_into_untracked(git_rw):
    await git_rw.execute("echo n > /repo/new.txt")
    await run(git_rw, "add new.txt")
    await run(git_rw, "restore --staged new.txt")
    assert (await run(git_rw, "status --porcelain"))[1] == b"?? new.txt\n"


@pytest.mark.asyncio
async def test_a_path_the_source_lacks_is_removed_from_the_target(
        git_rw, repo_path: Path):
    # b.txt arrived in the second commit, so the first tree lacks it, and
    # restoring both targets from that tree removes it from both.
    assert await run(git_rw, "restore -s HEAD~2 -SW b.txt") == (0, b"", b"")
    assert not (repo_path / "b.txt").exists()
    assert (await run(git_rw, "status --porcelain"))[1] == b"D  b.txt\n"


@pytest.mark.asyncio
async def test_a_deleted_file_comes_back(git_rw, repo_path: Path):
    (repo_path / "a.txt").unlink()
    await git_rw.execute("ls /repo")
    assert await run(git_rw, "restore a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"


def conflict_the_index(repo_path: Path, name: str) -> None:
    """Turn one staged path into an unmerged one, stages 1 to 3.

    Written straight into the index because reaching this state through
    the CLI would need a merge, and what is under test is what
    ``restore`` does to a path that is already conflicted.

    Args:
        repo_path (Path): the repository's working tree.
        name (str): the path to conflict, repository-relative.
    """
    index = Index(str(repo_path / ".git" / "index"))
    entry = index[name.encode()]
    assert isinstance(entry, IndexEntry)
    index[name.encode()] = ConflictedIndexEntry(ancestor=entry,
                                                this=entry,
                                                other=entry)
    index.write()


@pytest.mark.asyncio
async def test_restoring_the_index_clears_the_conflict_stages(
        git_rw, repo_path: Path):
    conflict_the_index(repo_path, "a.txt")
    assert await run(git_rw, "restore --staged a.txt") == (0, b"", b"")
    index = Index(str(repo_path / ".git" / "index"))
    assert not index.has_conflicts()
    assert isinstance(index[b"a.txt"], IndexEntry)
