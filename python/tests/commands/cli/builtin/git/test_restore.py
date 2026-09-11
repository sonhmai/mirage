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
from dulwich.index import Index, IndexEntry
from dulwich.repo import Repo

from mirage.commands.cli.builtin.git.restore import index_tree, parse_flags
from mirage.commands.spec.types import FlagView
from tests.commands.cli.builtin.git.conftest import conflict_index


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


@pytest.mark.asyncio
async def test_restoring_the_index_clears_the_conflict_stages(
        git_rw, repo_path: Path):
    conflict_index(repo_path, "a.txt")
    assert await run(git_rw, "restore --staged a.txt") == (0, b"", b"")
    index = Index(str(repo_path / ".git" / "index"))
    assert not index.has_conflicts()
    assert isinstance(index[b"a.txt"], IndexEntry)


@pytest.mark.asyncio
async def test_a_raw_tree_is_a_source(git_rw, repo_path: Path):
    with Repo(str(repo_path)) as repo:
        tree = repo[b"HEAD"].tree.decode()
    await git_rw.execute("echo edited > /repo/a.txt")
    assert await run(git_rw, f"restore --source={tree} a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"


@pytest.mark.asyncio
async def test_a_source_that_is_no_tree_is_still_refused(git_rw):
    code, _out, err = await run(git_rw, "restore --source=nosuch a.txt")
    assert code == 128
    assert err == b"fatal: could not resolve nosuch\n"


@pytest.mark.asyncio
async def test_a_directory_source_replaces_a_file(git_rw, repo_path: Path):
    await run(git_rw, "rm --cached a.txt")
    (repo_path / "a.txt").unlink()
    (repo_path / "a.txt").mkdir()
    (repo_path / "a.txt" / "child").write_text("inner\n", encoding="utf-8")
    await run(git_rw, "add a.txt")
    await run(git_rw, "commit -m dir")
    with Repo(str(repo_path)) as repo:
        tree = repo[b"HEAD"].tree.decode()
    await run(git_rw, "rm -r --cached a.txt")
    (repo_path / "a.txt" / "child").unlink()
    (repo_path / "a.txt").rmdir()
    (repo_path / "a.txt").write_text("flat\n", encoding="utf-8")
    await run(git_rw, "add a.txt")
    assert await run(git_rw,
                     f"restore --source={tree} -SW a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt" / "child").read_text() == "inner\n"
    # The source is HEAD's tree, so a restore that reached both the index
    # and the working tree leaves nothing for status to report.
    assert (await run(git_rw, "status --porcelain"))[1] == b""


@pytest.mark.asyncio
async def test_a_file_source_replaces_a_directory(git_rw, repo_path: Path):
    with Repo(str(repo_path)) as repo:
        tree = repo[b"HEAD"].tree.decode()
    await run(git_rw, "rm --cached a.txt")
    (repo_path / "a.txt").unlink()
    (repo_path / "a.txt").mkdir()
    (repo_path / "a.txt" / "child").write_text("inner\n", encoding="utf-8")
    await run(git_rw, "add a.txt")
    assert await run(git_rw,
                     f"restore --source={tree} -SW a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"
    assert not (repo_path / "a.txt" / "child").exists()


@pytest.mark.asyncio
async def test_a_conflict_the_source_cannot_put_back_is_refused(
        git_rw, repo_path: Path):
    # Added on this side only, so HEAD holds nothing to restore from
    # and the index holds no stage 0 either. git names the path rather
    # than reporting a pathspec it does not recognise.
    (repo_path / "c.txt").write_text("mine\n", encoding="utf-8")
    assert (await run(git_rw, "add c.txt"))[0] == 0
    conflict_index(repo_path, "c.txt")
    code, _out, err = await run(git_rw, "restore --staged c.txt")
    assert code == 1
    assert err == b"error: path 'c.txt' is unmerged\n"
    assert Index(str(repo_path / ".git" / "index")).has_conflicts()


@pytest.mark.asyncio
async def test_restoring_a_conflict_from_the_index_is_refused(
        git_rw, repo_path: Path):
    # The working tree restores from the index, and an unmerged path
    # has no stage 0 there whatever HEAD holds.
    conflict_index(repo_path, "a.txt")
    code, _out, err = await run(git_rw, "restore a.txt")
    assert code == 1
    assert err == b"error: path 'a.txt' is unmerged\n"


@pytest.mark.asyncio
async def test_every_unrestorable_conflict_is_named(git_rw, repo_path: Path):
    conflict_index(repo_path, "a.txt")
    conflict_index(repo_path, "b.txt")
    code, _out, err = await run(git_rw, "restore a.txt b.txt")
    assert code == 1
    assert err == (b"error: path 'a.txt' is unmerged\n"
                   b"error: path 'b.txt' is unmerged\n")


@pytest.mark.asyncio
async def test_a_source_holding_the_conflict_restores_it(
        git_rw, repo_path: Path):
    (repo_path / "c.txt").write_text("mine\n", encoding="utf-8")
    assert (await run(git_rw, "add c.txt"))[0] == 0
    assert (await run(git_rw, "commit -m added"))[0] == 0
    (repo_path / "c.txt").write_text("theirs\n", encoding="utf-8")
    assert (await run(git_rw, "add c.txt"))[0] == 0
    conflict_index(repo_path, "c.txt")
    assert await run(git_rw, "restore --staged c.txt") == (0, b"", b"")
    index = Index(str(repo_path / ".git" / "index"))
    assert not index.has_conflicts()


@pytest.mark.asyncio
async def test_a_tree_peel_is_a_source(git_rw, repo_path: Path):
    # git's own help says --source <tree-ish>, and a peel is the
    # ordinary way to spell one. Probed on git 2.50.1: exit 0.
    await git_rw.execute("echo edited > /repo/a.txt")
    assert await run(git_rw,
                     "restore --source=HEAD^{tree} a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"


@pytest.mark.asyncio
async def test_a_tag_peel_is_a_source(git_rw, repo_path: Path):
    assert (await run(git_rw, "tag v1"))[0] == 0
    await git_rw.execute("echo edited > /repo/a.txt")
    assert await run(git_rw,
                     "restore --source=v1^{tree} a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "one changed\n"


@pytest.mark.asyncio
async def test_a_subtree_at_a_path_is_a_source(git_rw, repo_path: Path):
    (repo_path / "sub").mkdir()
    (repo_path / "sub" / "a.txt").write_text("nested\n", encoding="utf-8")
    assert (await run(git_rw, "add sub"))[0] == 0
    assert (await run(git_rw, "commit -m nested"))[0] == 0
    assert await run(git_rw,
                     "restore --source=HEAD:sub a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").read_text() == "nested\n"


@pytest.mark.asyncio
async def test_a_source_that_is_no_tree_is_named_by_its_id(git_rw):
    # git reports the object it reached, not the spelling: the name
    # resolved fine and what it found was the problem.
    code, _out, err = await run(git_rw, "restore --source=HEAD:a.txt a.txt")
    assert code == 128
    assert err.startswith(b"fatal: unable to read tree (")
    assert err.endswith(b")\n")


@pytest.mark.asyncio
async def test_a_peel_that_resolves_to_nothing_is_named_as_typed(git_rw):
    code, _out, err = await run(git_rw, "restore --source=nosuch^{tree} a.txt")
    assert code == 128
    assert err == b"fatal: could not resolve nosuch^{tree}\n"


@pytest.mark.asyncio
async def test_a_file_replaces_a_directory_an_untracked_file_holds(
        git_rw, repo_path: Path):
    # The source keeps a.txt as a file, the index keeps a.txt/child, and
    # an untracked a.txt/keep holds the directory open. git replaces the
    # whole directory here, untracked child and all, and exits 0
    # (probed on git 2.50.1); the write would otherwise fail with the
    # index already changed.
    with Repo(str(repo_path)) as repo:
        tree = repo[b"HEAD"].tree.decode()
    await run(git_rw, "rm --cached a.txt")
    (repo_path / "a.txt").unlink()
    (repo_path / "a.txt").mkdir()
    (repo_path / "a.txt" / "child").write_text("inner\n", encoding="utf-8")
    await run(git_rw, "add a.txt/child")
    (repo_path / "a.txt" / "keep").write_text("untracked\n", encoding="utf-8")
    assert await run(git_rw,
                     f"restore --source={tree} -SW a.txt") == (0, b"", b"")
    assert (repo_path / "a.txt").is_file()
    assert (repo_path / "a.txt").read_text() == "one changed\n"


@pytest.mark.asyncio
async def test_a_staged_restore_before_the_first_commit_is_refused(unborn_rw):
    await unborn_rw.execute("echo hi > /repo/f.txt")
    await run(unborn_rw, "add f.txt")
    assert await run(
        unborn_rw,
        "restore --staged f.txt") == (128, b"",
                                      b"fatal: could not resolve HEAD\n")
    # The refusal comes before the index is touched: reading the
    # unborn HEAD as an empty tree unstaged the path and said nothing.
    assert await run(unborn_rw, "status --short") == (0, b"A  f.txt\n", b"")


@pytest.mark.asyncio
async def test_staged_and_worktree_together_refuse_the_same_way(unborn_rw):
    await unborn_rw.execute("echo hi > /repo/f.txt")
    await run(unborn_rw, "add f.txt")
    assert await run(
        unborn_rw,
        "restore -SW f.txt") == (128, b"", b"fatal: could not resolve HEAD\n")


@pytest.mark.asyncio
async def test_a_worktree_restore_before_the_first_commit_still_goes(
        unborn_rw):
    await unborn_rw.execute("echo hi > /repo/f.txt")
    await run(unborn_rw, "add f.txt")
    await unborn_rw.execute("echo edited > /repo/f.txt")
    # The working tree restores from the index, which exists before the
    # first commit, so only the implicit HEAD source has nothing to read.
    assert await run(unborn_rw, "restore f.txt") == (0, b"", b"")
    assert (await unborn_rw.execute("cat /repo/f.txt")).stdout == b"hi\n"
