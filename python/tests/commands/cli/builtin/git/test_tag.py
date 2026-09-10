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
from dulwich.objects import Commit, Tag
from dulwich.refs import Ref
from dulwich.repo import Repo

from mirage.commands.cli.builtin.git.tag import (parse_flags, render_listing,
                                                 selected_names, tag_names)
from mirage.commands.spec.types import FlagView
from tests.commands.cli.builtin.git.conftest import mounted_rw, pack_refs


async def run(ws, line: str) -> tuple[int, bytes, bytes]:
    """Run one git line against the mounted repository.

    Args:
        ws (Workspace): workspace with the repository and CLI.
        line (str): the command line, without the leading directory.
    """
    result = await ws.execute(f"git -C /repo {line}")
    return result.exit_code, result.stdout or b"", result.stderr or b""


def tag_object(repo_path: Path, name: str):
    """What a tag ref points at, read straight off disk.

    Args:
        repo_path (Path): the repository's working tree.
        name (str): the tag name.
    """
    with Repo(str(repo_path)) as repo:
        return repo[repo.refs[f"refs/tags/{name}".encode()]]


def test_a_bare_n_means_one_line():
    assert parse_flags(FlagView({"n": True})).lines == 1


def test_an_attached_count_is_read():
    assert parse_flags(FlagView({"n": "2"})).lines == 2


def test_no_n_means_no_message_lines():
    assert parse_flags(FlagView({})).lines is None


def test_a_message_implies_an_annotated_tag():
    parsed = parse_flags(FlagView({"message": ["m"]}))
    assert parsed.annotate and parsed.message == "m"


def test_several_messages_are_paragraphs():
    assert parse_flags(FlagView({"message": ["one",
                                             "two"]})).message == "one\n\ntwo"


def test_tag_names_sort_in_byte_order():
    known = {
        Ref(b"refs/tags/a10"),
        Ref(b"refs/tags/a9"),
        Ref(b"refs/tags/B"),
        Ref(b"refs/heads/main")
    }
    assert tag_names(known) == ["B", "a10", "a9"]


def test_patterns_keep_any_match():
    assert selected_names(["v0.9", "v1.0", "w"], ("v1*", "w")) == ["v1.0", "w"]


def test_no_pattern_keeps_everything():
    assert selected_names(["a", "b"], ()) == ["a", "b"]


def test_listing_pads_the_name_and_indents_continuations():
    rendered = render_listing(["v1", "v2"], {
        "v1": ["first", "second"],
        "v2": []
    }, 2)
    assert rendered == (b"v1              first\n"
                        b"    second\n"
                        b"v2              \n")


@pytest.mark.asyncio
async def test_a_bare_name_makes_a_lightweight_tag(git_rw, repo_path: Path):
    assert await run(git_rw, "tag v1.0") == (0, b"", b"")
    assert isinstance(tag_object(repo_path, "v1.0"), Commit)
    assert (await run(git_rw, "tag"))[1] == b"v1.0\n"


@pytest.mark.asyncio
async def test_a_tag_points_where_it_is_told(git_rw, repo_path: Path):
    await run(git_rw, "tag old HEAD~1")
    with Repo(str(repo_path)) as repo:
        parent = repo[repo.refs[b"refs/heads/main"]].parents[0]
        assert repo.refs[b"refs/tags/old"] == parent


@pytest.mark.asyncio
async def test_a_message_writes_a_tag_object(git_rw, repo_path: Path):
    assert await run(git_rw, "tag -a v1.1 -m 'first release'") == (0, b"", b"")
    written = tag_object(repo_path, "v1.1")
    assert isinstance(written, Tag)
    assert written.message == b"first release\n"
    assert written.tagger == b"mirage <mirage@localhost>"
    assert (await run(git_rw,
                      "tag -n"))[1] == b"v1.1            first release\n"


@pytest.mark.asyncio
async def test_annotated_needs_a_message(git_rw):
    code, _out, err = await run(git_rw, "tag -a v1.2")
    assert code == 128
    assert err == (b"fatal: no tag message supplied (mirage has no editor "
                   b"to open; pass -m)\n")


@pytest.mark.asyncio
async def test_a_name_that_exists_is_refused(git_rw):
    await run(git_rw, "tag v1.0")
    code, _out, err = await run(git_rw, "tag v1.0")
    assert code == 128
    assert err == b"fatal: tag 'v1.0' already exists\n"


@pytest.mark.asyncio
async def test_force_moves_the_tag(git_rw):
    await run(git_rw, "tag v1.0 HEAD~1")
    code, out, _err = await run(git_rw, "tag -f v1.0")
    assert code == 0
    assert out.startswith(b"Updated tag 'v1.0' (was ")


@pytest.mark.asyncio
async def test_an_object_it_cannot_resolve_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "tag v2 nosuchrev")
    assert code == 128
    assert err == b"fatal: Failed to resolve 'nosuchrev' as a valid ref.\n"


@pytest.mark.asyncio
async def test_an_invalid_name_is_fatal(git_rw):
    code, _out, err = await run(git_rw, "tag 'bad name'")
    assert code == 128
    assert err == b"fatal: 'bad name' is not a valid tag name.\n"


@pytest.mark.asyncio
async def test_l_filters_by_pattern(git_rw):
    await run(git_rw, "tag v0.9")
    await run(git_rw, "tag v1.0")
    assert (await run(git_rw, "tag -l 'v1*'"))[1] == b"v1.0\n"


@pytest.mark.asyncio
async def test_d_deletes_and_reports_a_miss_without_stopping(git_rw):
    await run(git_rw, "tag v1.0")
    code, out, err = await run(git_rw, "tag -d nosuch v1.0")
    assert code == 1
    assert out.startswith(b"Deleted tag 'v1.0' (was ")
    assert err == b"error: tag 'nosuch' not found.\n"
    assert (await run(git_rw, "tag"))[1] == b""


@pytest.mark.asyncio
async def test_l_and_d_cannot_mix(git_rw):
    code, _out, err = await run(git_rw, "tag -d -l")
    assert code == 129
    assert err == b"error: options '-l' and '-d' cannot be used together\n"


@pytest.mark.asyncio
async def test_a_tag_on_a_tag_points_at_the_tag_object(git_rw,
                                                       repo_path: Path):
    await run(git_rw, "tag -a v1 -m m")
    await run(git_rw, "tag alias v1")
    assert isinstance(tag_object(repo_path, "alias"), Tag)


@pytest.mark.asyncio
async def test_a_tag_resolves_as_a_revision(git_rw):
    await run(git_rw, "tag old HEAD~1")
    assert (await run(git_rw,
                      "log --oneline -n 1 old"))[1].endswith(b" second\n")


@pytest.mark.asyncio
@pytest.mark.parametrize("line", ["tag -a", "tag -m msg", "tag -f"])
async def test_a_creation_option_needs_a_name(git_rw, line: str):
    code, _out, err = await run(git_rw, line)
    assert code == 129
    assert err == (b"usage: git tag [-a] [-f] [-m <msg>] <tagname> "
                   b"[<commit> | <object>]\n"
                   b"   or: git tag -d <tagname>...\n"
                   b"   or: git tag [-n[<num>]] -l [<pattern>...]\n")


@pytest.mark.asyncio
@pytest.mark.parametrize("line", ["tag -l -a v1", "tag -d -a v1", "tag -n -f"])
async def test_a_creation_option_cannot_list_or_delete(git_rw, line: str):
    code, _out, err = await run(git_rw, line)
    assert code == 129
    assert err.startswith(b"usage: git tag [-a] [-f] [-m <msg>]")


@pytest.mark.asyncio
async def test_listing_and_deleting_still_take_no_name(git_rw):
    assert await run(git_rw, "tag") == (0, b"", b"")
    assert await run(git_rw, "tag -d") == (0, b"", b"")


@pytest.mark.asyncio
async def test_force_still_creates_when_a_name_is_given(git_rw):
    assert await run(git_rw, "tag -f v1") == (0, b"", b"")
    assert (await run(git_rw, "tag"))[1] == b"v1\n"


@pytest.mark.asyncio
async def test_deleting_a_packed_tag_removes_it(repo_path: Path):
    with mounted_rw(repo_path) as ws:
        await run(ws, "tag lw")
        await run(ws, "tag -a ann -m msg")
    pack_refs(repo_path)
    loose = repo_path / ".git" / "refs" / "tags"
    assert not loose.exists() or not any(loose.iterdir())
    with mounted_rw(repo_path) as ws:
        code, out, _err = await run(ws, "tag -d lw")
        assert (code, out.split(b" (was")[0]) == (0, b"Deleted tag 'lw'")
        assert (await run(ws, "tag -d ann"))[0] == 0
        assert (await run(ws, "tag"))[1] == b""
    packed = (repo_path / ".git" / "packed-refs").read_text()
    assert "refs/tags/" not in packed
    assert "^" not in packed
    assert "refs/heads/main" in packed
