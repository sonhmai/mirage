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
from dulwich.refs import Ref
from dulwich.repo import Repo

from mirage.commands.cli.builtin.git.switch import expected_kind


async def run(ws, line: str) -> tuple[int, bytes, bytes]:
    """Run one git line against the mounted repository.

    Args:
        ws (Workspace): workspace with the repository and CLI.
        line (str): the command line, without the leading directory.
    """
    result = await ws.execute(f"git -C /repo {line}")
    return result.exit_code, result.stdout or b"", result.stderr or b""


def head_ref(repo_path: Path) -> bytes:
    """What ``.git/HEAD`` holds, read straight off disk.

    Args:
        repo_path (Path): the repository's working tree.
    """
    return (repo_path / ".git" / "HEAD").read_bytes().strip()


def test_a_tag_is_named_as_one():
    known = {Ref(b"refs/tags/v1"), Ref(b"refs/heads/main")}
    assert expected_kind(known, "v1") == "tag"


def test_a_remote_tracking_branch_is_named_as_one():
    known = {Ref(b"refs/remotes/origin/main")}
    assert expected_kind(known, "origin/main") == "remote branch"


def test_anything_else_is_a_commit():
    assert expected_kind(set(), "265ec3a") == "commit"


@pytest.mark.asyncio
async def test_switch_moves_to_a_branch(git_rw, repo_path: Path):
    await run(git_rw, "branch topic")
    assert await run(git_rw, "switch topic") == (0, b"", b"Switched to branch "
                                                 b"'topic'\n")
    assert head_ref(repo_path) == b"ref: refs/heads/topic"


@pytest.mark.asyncio
async def test_already_on_the_branch(git_rw):
    assert await run(git_rw, "switch main") == (0, b"", b"Already on 'main'\n")


@pytest.mark.asyncio
async def test_c_creates_and_switches(git_rw, repo_path: Path):
    assert await run(git_rw,
                     "switch -c fresh") == (0, b"", b"Switched to a new "
                                            b"branch 'fresh'\n")
    assert head_ref(repo_path) == b"ref: refs/heads/fresh"


@pytest.mark.asyncio
async def test_c_starts_where_it_is_told(git_rw, repo_path: Path):
    await run(git_rw, "switch -c older HEAD~1")
    with Repo(str(repo_path)) as repo:
        parent = repo[repo.refs[b"refs/heads/main"]].parents[0]
        assert repo.refs[b"refs/heads/older"] == parent


@pytest.mark.asyncio
async def test_c_refuses_a_branch_that_exists(git_rw):
    code, _out, err = await run(git_rw, "switch -c main")
    assert code == 128
    assert err == b"fatal: a branch named 'main' already exists\n"


@pytest.mark.asyncio
async def test_an_unknown_name_is_an_invalid_reference(git_rw):
    code, _out, err = await run(git_rw, "switch nosuch")
    assert code == 128
    assert err == b"fatal: invalid reference: nosuch\n"


@pytest.mark.asyncio
async def test_a_commit_needs_detach(git_rw, repo_path: Path):
    with Repo(str(repo_path)) as repo:
        sha = repo.refs[b"refs/heads/main"].decode()
    code, _out, err = await run(git_rw, f"switch {sha[:7]}")
    assert code == 128
    assert err == (f"fatal: a branch is expected, got commit '{sha[:7]}'\n"
                   f"hint: If you want to detach HEAD at the commit, try "
                   f"again with the --detach option.\n").encode()
    assert head_ref(repo_path) == b"ref: refs/heads/main"


@pytest.mark.asyncio
async def test_detach_lands_on_the_commit(git_rw, repo_path: Path):
    code, out, err = await run(git_rw, "switch --detach HEAD~1")
    assert (code, out) == (0, b"")
    assert err.startswith(b"HEAD is now at ")
    assert err.endswith(b" second\n")
    assert not head_ref(repo_path).startswith(b"ref:")


@pytest.mark.asyncio
async def test_leaving_a_detached_head_names_where_it_was(git_rw):
    await run(git_rw, "switch --detach HEAD~1")
    _code, _out, err = await run(git_rw, "switch main")
    lines = err.splitlines()
    assert lines[0].startswith(b"Previous HEAD position was ")
    assert lines[0].endswith(b" second")
    assert lines[1] == b"Switched to branch 'main'"


@pytest.mark.asyncio
async def test_switch_refuses_to_lose_an_edit(git_rw, repo_path: Path):
    await run(git_rw, "branch older HEAD~1")
    await git_rw.execute("echo precious > /repo/a.txt")
    code, _out, err = await run(git_rw, "switch older")
    assert code == 1
    assert err.startswith(
        b"error: Your local changes to the following "
        b"files would be overwritten by checkout:\n\ta.txt\n")
    assert (repo_path / "a.txt").read_text() == "precious\n"


@pytest.mark.asyncio
async def test_no_operand_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "switch")
    assert code == 128
    assert err == b"fatal: missing branch or commit argument\n"


@pytest.mark.asyncio
async def test_two_operands_are_fatal(git_rw):
    code, _out, err = await run(git_rw, "switch main main")
    assert code == 128
    assert err == b"fatal: only one reference expected\n"


@pytest.mark.asyncio
async def test_create_and_detach_do_not_mix(git_rw):
    code, _out, err = await run(git_rw, "switch -c x -d")
    assert code == 128
    assert err == b"fatal: '--detach' cannot be used with '-b/-B/--orphan'\n"


@pytest.mark.asyncio
async def test_switch_c_refuses_a_name_that_escapes_the_ref_tree(
        git_rw, repo_path: Path):
    before = (repo_path / ".git" / "config").read_bytes()
    code, _out, err = await run(git_rw, "switch -c ../../config")
    assert code == 128
    assert err == (b"fatal: '../../config' is not a valid branch name\n"
                   b"hint: See `man git check-ref-format`\n"
                   b'hint: Disable this message with "git config set '
                   b'advice.refSyntax false"\n')
    assert (repo_path / ".git" / "config").read_bytes() == before


@pytest.mark.asyncio
async def test_switch_c_refuses_a_name_holding_a_space(git_rw):
    code, _out, err = await run(git_rw, "switch -c 'bad name'")
    assert code == 128
    assert err.startswith(b"fatal: 'bad name' is not a valid branch name\n")


@pytest.mark.asyncio
async def test_an_unresolvable_start_point_is_named_first(git_rw):
    _code, _out, err = await run(git_rw, "switch -c ../../config nosuchstart")
    assert err == b"fatal: invalid reference: nosuchstart\n"


@pytest.mark.asyncio
async def test_detach_with_no_operand_takes_head(git_rw, repo_path: Path):
    code, _out, err = await run(git_rw, "switch --detach")
    assert code == 0
    assert err.startswith(b"HEAD is now at ")
    with Repo(str(repo_path)) as repo:
        main = repo.refs[Ref(b"refs/heads/main")]
        assert repo.refs.read_ref(b"HEAD") == main


@pytest.mark.asyncio
async def test_a_plain_switch_still_needs_a_branch(git_rw):
    code, _out, err = await run(git_rw, "switch")
    assert code == 128
    assert err.startswith(b"fatal: ")


@pytest.mark.asyncio
async def test_an_untracked_file_blocks_a_directory_the_target_holds(
        git_rw, repo_path: Path):
    await run(git_rw, "switch -c other")
    (repo_path / "slot").mkdir()
    (repo_path / "slot" / "file").write_text("x\n", encoding="utf-8")
    await run(git_rw, "add slot")
    await run(git_rw, "commit -m dir")
    await run(git_rw, "switch main")
    # The switch removed the tracked file and left the directory that
    # held it, so the untracked file has to take its place.
    (repo_path / "slot").rmdir()
    (repo_path / "slot").write_text("mine\n", encoding="utf-8")
    code, _out, err = await run(git_rw, "switch other")
    assert code == 1
    assert err == (b"error: The following untracked working tree files would "
                   b"be overwritten by checkout:\n\tslot\nPlease move or "
                   b"remove them before you switch branches.\nAborting\n")
    assert (repo_path / "slot").read_text() == "mine\n"


@pytest.mark.asyncio
async def test_an_untracked_file_inside_a_directory_the_target_replaces(
        git_rw, repo_path: Path):
    await run(git_rw, "switch -c other")
    (repo_path / "slot").write_text("theirs\n", encoding="utf-8")
    await run(git_rw, "add slot")
    await run(git_rw, "commit -m file")
    await run(git_rw, "switch main")
    (repo_path / "slot").mkdir()
    (repo_path / "slot" / "file").write_text("mine\n", encoding="utf-8")
    code, _out, err = await run(git_rw, "switch other")
    assert code == 1
    assert err == (b"error: Updating the following directories would lose "
                   b"untracked files in them:\n\tslot\n\nAborting\n")
    assert (repo_path / "slot" / "file").read_text() == "mine\n"
