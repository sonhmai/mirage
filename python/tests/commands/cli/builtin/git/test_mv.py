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

from mirage.commands.cli.builtin.git.mv import Move, moved_path, parse_flags
from mirage.commands.spec.types import FlagView


async def run(ws, line: str) -> tuple[int, bytes, bytes]:
    """Run one git line against the mounted repository.

    Args:
        ws (Workspace): workspace with the repository and CLI.
        line (str): the command line, without the leading directory.
    """
    result = await ws.execute(f"git -C /repo {line}")
    return result.exit_code, result.stdout or b"", result.stderr or b""


def test_dry_run_implies_verbose():
    parsed = parse_flags(FlagView({"dry_run": True}))
    assert parsed.dry_run and parsed.verbose


def test_a_file_lands_at_its_destination():
    move = Move("a.txt", "b/c.txt", ("a.txt", ), False)
    assert moved_path(move, "a.txt") == "b/c.txt"


def test_a_directory_keeps_the_path_below_it():
    move = Move("docs", "notes", ("docs/one.md", "docs/sub/two.md"), True)
    assert moved_path(move, "docs/sub/two.md") == "notes/sub/two.md"


@pytest.mark.asyncio
async def test_mv_renames_and_stages_the_rename(git_rw, repo_path: Path):
    assert await run(git_rw, "mv a.txt c.txt") == (0, b"", b"")
    assert (repo_path / "c.txt").exists()
    assert not (repo_path / "a.txt").exists()
    assert (await run(git_rw,
                      "status --porcelain"))[1] == b"R  a.txt -> c.txt\n"


@pytest.mark.asyncio
async def test_verbose_names_the_move(git_rw):
    assert await run(git_rw, "mv -v a.txt c.txt") == (0, b"Renaming a.txt to "
                                                      b"c.txt\n", b"")


@pytest.mark.asyncio
async def test_a_missing_source_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "mv nosuch c.txt")
    assert code == 128
    assert err == b"fatal: bad source, source=nosuch, destination=c.txt\n"


@pytest.mark.asyncio
async def test_an_untracked_source_is_fatal(git_rw):
    await git_rw.execute("echo u > /repo/u.txt")
    _code, _out, err = await run(git_rw, "mv u.txt c.txt")
    assert err == (b"fatal: not under version control, source=u.txt, "
                   b"destination=c.txt\n")


@pytest.mark.asyncio
async def test_an_existing_destination_is_refused_unless_forced(
        git_rw, repo_path: Path):
    _code, _out, err = await run(git_rw, "mv a.txt b.txt")
    assert err == (b"fatal: destination exists, source=a.txt, "
                   b"destination=b.txt\n")
    assert await run(git_rw, "mv -f a.txt b.txt") == (0, b"", b"")
    assert (repo_path / "b.txt").read_text() == "one changed\n"
    assert (await run(git_rw, "status --porcelain"))[1] == (b"D  a.txt\n"
                                                            b"M  b.txt\n")


@pytest.mark.asyncio
async def test_a_directory_destination_takes_the_basename(git_rw):
    await git_rw.execute("mkdir /repo/into")
    await run(git_rw, "mv a.txt into")
    assert (await run(git_rw,
                      "status --porcelain"))[1] == b"R  a.txt -> into/a.txt\n"


@pytest.mark.asyncio
async def test_several_sources_need_a_directory(git_rw):
    _code, _out, err = await run(git_rw, "mv a.txt b.txt nowhere")
    assert err == b"fatal: destination 'nowhere' is not a directory\n"


@pytest.mark.asyncio
async def test_a_directory_moves_with_everything_under_it(
        git_rw, repo_path: Path):
    await git_rw.execute("mkdir /repo/docs && echo x > /repo/docs/one.md")
    await run(git_rw, "add docs")
    await run(git_rw, "commit -m docs")
    await git_rw.execute("echo u > /repo/docs/untracked.md")
    assert await run(git_rw, "mv docs notes") == (0, b"", b"")
    assert (repo_path / "notes" / "untracked.md").exists()
    assert (await run(git_rw, "status --porcelain"))[1] == (
        b"R  docs/one.md -> notes/one.md\n?? notes/untracked.md\n")


@pytest.mark.asyncio
async def test_one_operand_prints_the_usage(git_rw):
    code, _out, err = await run(git_rw, "mv a.txt")
    assert code == 129
    assert err.startswith(b"usage: git mv [-v] [-f] [-n] [-k] <source> "
                          b"<destination>\n")


@pytest.mark.asyncio
async def test_dry_run_moves_nothing(git_rw, repo_path: Path):
    code, out, _err = await run(git_rw, "mv -n a.txt c.txt")
    assert code == 0
    assert out == (b"Checking rename of 'a.txt' to 'c.txt'\n"
                   b"Renaming a.txt to c.txt\n")
    assert (repo_path / "a.txt").exists()


@pytest.mark.asyncio
async def test_k_skips_a_source_that_cannot_move(git_rw):
    assert await run(git_rw, "mv -k nosuch c.txt") == (0, b"", b"")


@pytest.mark.asyncio
async def test_a_missing_destination_directory_is_the_renames_failure(git_rw):
    code, _out, err = await run(git_rw, "mv a.txt nodir/c.txt")
    assert code == 128
    assert err == (b"fatal: renaming 'a.txt' failed: No such file or "
                   b"directory\n")
