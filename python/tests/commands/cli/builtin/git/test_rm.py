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

from mirage.commands.cli.builtin.git.errors import (NotRecursiveError,
                                                    PathspecError)
from mirage.commands.cli.builtin.git.rm import RmFlags, parse_flags, select
from mirage.commands.cli.builtin.git.types import RepoLocation
from mirage.commands.spec.types import FlagView

LOCATION = RepoLocation(gitdir="/repo/.git",
                        commondir="/repo/.git",
                        worktree="/repo",
                        mount_root="/repo")
TRACKED = {"a.txt", "docs/one.md", "docs/two.md"}


def flags(**given: bool) -> RmFlags:
    """An RmFlags with every flag off except the ones named.

    Args:
        given (bool): flags to switch on, by field name.
    """
    return RmFlags(recursive=given.get("recursive", False),
                   cached=given.get("cached", False),
                   force=given.get("force", False),
                   quiet=given.get("quiet", False),
                   ignore_unmatch=given.get("ignore_unmatch", False))


async def run(ws, line: str) -> tuple[int, bytes, bytes]:
    """Run one git line against the mounted repository.

    Args:
        ws (Workspace): workspace with the repository and CLI.
        line (str): the command line, without the leading directory.
    """
    result = await ws.execute(f"git -C /repo {line}")
    return result.exit_code, result.stdout or b"", result.stderr or b""


def test_flags_read_their_long_and_short_spellings():
    parsed = parse_flags(
        FlagView({
            "r": True,
            "cached": True,
            "force": True,
            "quiet": True,
            "ignore_unmatch": True
        }))
    assert parsed == flags(recursive=True,
                           cached=True,
                           force=True,
                           quiet=True,
                           ignore_unmatch=True)


def test_a_file_operand_selects_itself():
    assert select(LOCATION, "/repo", ("a.txt", ), TRACKED,
                  flags()) == ["a.txt"]


def test_a_directory_needs_r():
    with pytest.raises(NotRecursiveError):
        select(LOCATION, "/repo", ("docs", ), TRACKED, flags())


def test_r_expands_a_directory_in_index_order():
    assert select(LOCATION, "/repo", ("docs", ), TRACKED,
                  flags(recursive=True)) == ["docs/one.md", "docs/two.md"]


def test_an_unknown_operand_is_fatal_before_anything_is_selected():
    with pytest.raises(PathspecError):
        select(LOCATION, "/repo", ("a.txt", "nosuch"), TRACKED, flags())


def test_ignore_unmatch_skips_an_unknown_operand():
    assert select(LOCATION, "/repo", ("nosuch", "a.txt"), TRACKED,
                  flags(ignore_unmatch=True)) == ["a.txt"]


@pytest.mark.asyncio
async def test_rm_stages_a_deletion_and_removes_the_file(
        git_rw, repo_path: Path):
    assert await run(git_rw, "rm a.txt") == (0, b"rm 'a.txt'\n", b"")
    assert not (repo_path / "a.txt").exists()
    assert (await run(git_rw, "status --porcelain"))[1] == b"D  a.txt\n"


@pytest.mark.asyncio
async def test_cached_keeps_the_file(git_rw, repo_path: Path):
    code, out, _err = await run(git_rw, "rm --cached a.txt")
    assert (code, out) == (0, b"rm 'a.txt'\n")
    assert (repo_path / "a.txt").exists()
    assert (await run(git_rw, "status --porcelain"))[1] == (b"D  a.txt\n"
                                                            b"?? a.txt\n")


@pytest.mark.asyncio
async def test_a_local_modification_is_refused(git_rw, repo_path: Path):
    await git_rw.execute("echo edited > /repo/a.txt")
    code, out, err = await run(git_rw, "rm a.txt")
    assert (code, out) == (1, b"")
    assert err == (
        b"error: the following file has local modifications:\n"
        b"    a.txt\n"
        b"(use --cached to keep the file, or -f to force removal)\n")
    assert (repo_path / "a.txt").exists()


@pytest.mark.asyncio
async def test_a_staged_change_is_refused_with_its_own_wording(git_rw):
    await git_rw.execute("echo edited > /repo/a.txt")
    await run(git_rw, "add a.txt")
    _code, _out, err = await run(git_rw, "rm a.txt")
    assert err.startswith(b"error: the following file has changes staged "
                          b"in the index:\n    a.txt\n")


@pytest.mark.asyncio
async def test_force_removes_over_an_edit(git_rw, repo_path: Path):
    await git_rw.execute("echo edited > /repo/a.txt")
    assert await run(git_rw, "rm -f a.txt") == (0, b"rm 'a.txt'\n", b"")
    assert not (repo_path / "a.txt").exists()


@pytest.mark.asyncio
async def test_quiet_prints_nothing(git_rw):
    assert await run(git_rw, "rm -q b.txt") == (0, b"", b"")


@pytest.mark.asyncio
async def test_no_pathspec_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "rm")
    assert code == 128
    assert err == (b"fatal: No pathspec was given. Which files should I "
                   b"remove?\n")


@pytest.mark.asyncio
async def test_a_directory_is_refused_without_r_and_removed_with_it(
        git_rw, repo_path: Path):
    await git_rw.execute("mkdir /repo/docs && echo x > /repo/docs/one.md")
    await run(git_rw, "add docs")
    await run(git_rw, "commit -m docs")
    code, _out, err = await run(git_rw, "rm docs")
    assert code == 128
    assert err == b"fatal: not removing 'docs' recursively without -r\n"
    assert await run(git_rw, "rm -r docs") == (0, b"rm 'docs/one.md'\n", b"")
    # git removes the directory its last tracked file left empty.
    assert not (repo_path / "docs").exists()
