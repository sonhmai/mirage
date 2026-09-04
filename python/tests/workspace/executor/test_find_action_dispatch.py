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
"""Tests for find's action flags (-delete, -print0, -ls).

Per-resource find handlers only emit matched paths. The dispatcher
(`mirage/workspace/executor/find_action_dispatch.py:_apply_find_actions`)
reads the parsed action flags and applies the corresponding side
effect or output reformat.
"""
import asyncio

import pytest

from mirage.resource.ram import RAMResource
from mirage.types import MountMode
from mirage.workspace import Workspace


def _ws() -> Workspace:
    return Workspace({"/": RAMResource()}, mode=MountMode.WRITE)


def _ws_two_mounts() -> Workspace:
    return Workspace({
        "/a": (RAMResource(), MountMode.WRITE),
        "/b": (RAMResource(), MountMode.WRITE),
    })


def _run(coro):
    return asyncio.run(coro)


async def _setup_html_files(ws: Workspace) -> None:
    ws.create_session("s")
    await ws.execute("mkdir -p /a/b", session_id="s")
    await ws.execute("touch /foo.html /bar.htm /a/b/baz.html", session_id="s")


# ── -delete ────────────────────────────────────────────────────


def test_delete_removes_matched_files() -> None:

    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html' -delete", session_id="s")
        assert r.exit_code == 0
        assert await r.stdout_str() == ""
        assert await r.stderr_str() == ""
        # html files gone
        check = await ws.execute("find / -name '*.html'", session_id="s")
        assert await check.stdout_str() == ""
        # htm preserved
        htm = await ws.execute("find / -name '*.htm'", session_id="s")
        assert "/bar.htm" in await htm.stdout_str()

    _run(_go())


def test_delete_silent_unless_print() -> None:

    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html' -delete", session_id="s")
        assert await r.stdout_str() == ""

    _run(_go())


def test_delete_with_print_emits_matches() -> None:

    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html' -print -delete",
                             session_id="s")
        out = await r.stdout_str()
        assert "/foo.html" in out
        assert "/a/b/baz.html" in out

    _run(_go())


def test_delete_skips_mount_roots() -> None:
    # A mount root in the match set must not be unlinked: mounts
    # are structural metadata.
    async def _go():
        ws = _ws_two_mounts()
        ws.create_session("s")
        await ws.execute("touch /a/x.html /b/y.html", session_id="s")
        # Force mount roots into the match set via -type d, then
        # -delete must skip them while still listing them in find.
        # Without a -name pattern the synthetic /a and /b appear.
        await ws.execute("find / -type d -delete", session_id="s")
        # Mount roots survive (delete may report errors for other
        # dir entries, that's fine).
        ls = await ws.execute("ls /", session_id="s")
        out = await ls.stdout_str()
        assert "a" in out
        assert "b" in out

    _run(_go())


def test_delete_deepest_first() -> None:
    # Children deleted before parents so non-empty-dir errors
    # don't fire.
    async def _go():
        ws = _ws()
        ws.create_session("s")
        await ws.execute("mkdir -p /tmp/a/b", session_id="s")
        await ws.execute("touch /tmp/a/b/file.txt", session_id="s")
        r = await ws.execute("find /tmp -name '*.txt' -delete", session_id="s")
        assert r.exit_code == 0

    _run(_go())


# ── -print0 ────────────────────────────────────────────────────


def test_print0_separates_with_nul() -> None:

    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html' -print0", session_id="s")
        out = await r.stdout_str()
        assert "\x00" in out
        assert "\n" not in out.replace("\x00", "")
        assert out.endswith("\x00")

    _run(_go())


# ── -ls ────────────────────────────────────────────────────────


def test_ls_emits_long_format_per_match() -> None:

    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html' -ls", session_id="s")
        out = await r.stdout_str()
        # ls -ld output per match: starts with permission bits.
        lines = [ln for ln in out.split("\n") if ln]
        assert len(lines) >= 2
        for line in lines:
            assert line.startswith(("-", "d", "l"))

    _run(_go())


# ── default behavior unchanged ─────────────────────────────────


def test_no_action_flag_unchanged() -> None:
    # find without action flags must behave as before.
    async def _go():
        ws = _ws()
        await _setup_html_files(ws)
        r = await ws.execute("find / -name '*.html'", session_id="s")
        out = await r.stdout_str()
        assert "/foo.html" in out
        assert "/a/b/baz.html" in out
        assert "\x00" not in out

    _run(_go())


# ── synthetic mount entries honor -name ───────────────────────


def test_mount_entries_filtered_by_name() -> None:
    # Without -type filter, mount roots are synthesized as dir
    # entries. -name must still apply to those entries so user
    # intent ("find files matching X") isn't overridden by
    # spurious mount listings.
    async def _go():
        ws = _ws_two_mounts()
        ws.create_session("s")
        # /a and /b are mounts; -name 'a' should match only /a.
        r = await ws.execute("find / -name 'a' -type d", session_id="s")
        lines = (await r.stdout_str()).strip().split("\n")
        assert "/a" in lines
        assert "/b" not in lines

    _run(_go())


def test_delete_removes_emptied_directories() -> None:

    async def _go():
        ws = _ws()
        ws.create_session("s")
        await ws.execute("mkdir -p /tree/deep", session_id="s")
        await ws.execute("touch /tree/deep/f.txt", session_id="s")
        r = await ws.execute("find /tree -delete", session_id="s")
        assert r.exit_code == 0
        assert await r.stderr_str() == ""
        check = await ws.execute("find / -name tree", session_id="s")
        assert await check.stdout_str() == ""
        await ws.close()

    _run(_go())


# ── -exec ──────────────────────────────────────────────────


async def _exec_ws() -> Workspace:
    ws = _ws()
    ws.create_session("s")
    await ws.execute(
        "mkdir -p /w/d/sub; printf 'a\\n' > /w/d/a.txt; "
        "printf 'bb\\n' > /w/d/b.txt; printf x > /w/d/sub/c.txt; cd /w",
        session_id="s")
    return ws


async def _run_line(ws: Workspace, line: str) -> tuple[str, str, int]:
    r = await ws.execute(line, session_id="s")
    return await r.stdout_str(), await r.stderr_str(), r.exit_code


@pytest.mark.asyncio
@pytest.mark.parametrize("line,stdout,stderr,code", [
    (r'find d -name "*.txt" -exec echo got {} \;',
     "got d/a.txt\ngot d/b.txt\ngot d/sub/c.txt\n", "", 0),
    ('find d -name "*.txt" -exec echo got {} +',
     "got d/a.txt d/b.txt d/sub/c.txt\n", "", 0),
    (r'find d -name "*.txt" -exec false \;', "", "", 0),
    ('find d -name "*.txt" -exec false {} +', "", "", 1),
    (r'find d -name "*.txt" -exec false \; -print', "", "", 0),
    (r'find d -name "*.txt" -exec echo {} \; -print',
     "d/a.txt\nd/a.txt\nd/b.txt\nd/b.txt\nd/sub/c.txt\nd/sub/c.txt\n", "", 0),
    (r'find d -name "*.txt" -exec nosuchcmd {} \;', "",
     "find: 'nosuchcmd': No such file or directory\n" * 3, 0),
    (r'find d -name "*.txt" -exec echo x{}y \;',
     "xd/a.txty\nxd/b.txty\nxd/sub/c.txty\n", "", 0),
    (r'find d -name "*.txt" -exec echo pre {} \; -exec echo post {} \;',
     "pre d/a.txt\npost d/a.txt\npre d/b.txt\npost d/b.txt\n"
     "pre d/sub/c.txt\npost d/sub/c.txt\n", "", 0),
    (r'find d -name "*.txt" -exec echo "a b" {} \;',
     "a b d/a.txt\na b d/b.txt\na b d/sub/c.txt\n", "", 0),
    ('find d -name "*.txt" -exec sh -c "echo err >&2; exit 3" {} +', "",
     "err\n", 1),
    (r'find d -name "*.txt" -exec echo {} \; -exec false \; -print',
     "d/a.txt\nd/b.txt\nd/sub/c.txt\n", "", 0),
    (r'find d -name "*.txt" -exec grep -q x {} \; -print', "d/sub/c.txt\n", "",
     0),
    ('find d -name "*.txt" -exec echo {} + -print',
     "d/a.txt\nd/b.txt\nd/sub/c.txt\nd/a.txt d/b.txt d/sub/c.txt\n", "", 0),
    ('find d -name nomatch -exec echo batch {} +', "", "", 0),
    ('find d \\( -name a.txt -o -name b.txt \\) -exec echo {} \\;',
     "d/a.txt\nd/b.txt\n", "", 0),
    (r'find -name a.txt -exec echo {} \;', "./d/a.txt\n", "", 0),
    (r'find /w/d -name b.txt -exec echo abs {} \;', "abs /w/d/b.txt\n", "", 0),
])
async def test_exec_matches_gnu(line, stdout, stderr, code):
    # Pinned against GNU findutils on debian:stable-slim.
    ws = await _exec_ws()
    assert await _run_line(ws, line) == (stdout, stderr, code)


@pytest.mark.asyncio
async def test_exec_with_print0_interleaves():
    ws = await _exec_ws()
    out, _, code = await _run_line(
        ws, r'find d -name a.txt -exec echo {} \; -print0')
    assert out == "d/a.txt\nd/a.txt\0"
    assert code == 0


@pytest.mark.asyncio
async def test_exec_then_delete_removes_accepted_rows():
    ws = await _exec_ws()
    out, err, code = await _run_line(
        ws, r'find d -name "*.txt" -exec cat {} \; -delete')
    assert (out, err, code) == ("a\nbb\nx", "", 0)
    listing, _, _ = await _run_line(ws, "find d -type f")
    assert listing == ""


@pytest.mark.asyncio
async def test_exec_line_substitution():
    from mirage.commands.builtin.find_parse import ExecAction
    from mirage.workspace.executor.find_action_dispatch import exec_line
    per = ExecAction(("echo", "x{}y", "{}"), batch=False)
    assert exec_line(per, ["a b"]) == "echo 'xa by' 'a b'"
    batch = ExecAction(("echo", "{}", "tail"), batch=True)
    assert exec_line(batch, ["a", "b c"]) == "echo a 'b c' tail"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action,terminator",
    [(action, r"\;")
     for action in ('cd /', 'unset KEEP', 'export KEEP=child', 'set -- child',
                    'set -u', 'mutate', 'mutate_exit')] +
    [(action, '{} +') for action in ('batch', 'mutate', 'mutate_exit')])
async def test_exec_isolates_each_invocation(action, terminator):
    ws = await _exec_ws()
    try:
        await ws.execute(
            'batch() { KEEP=child; cd /; set -- child; set -u; }; '
            'KEEP=parent; set -- original; '
            'mutate() { echo "$KEEP:$PWD"; KEEP=child; cd /; }; '
            'mutate_exit() { KEEP=child; cd /; exit 7; }',
            session_id='s')
        io = await ws.execute(
            f'find d -name "*.txt" -exec {action} {terminator}; '
            'echo "$KEEP:$PWD:$1"; echo "${UNSET_FOR_TEST}"',
            session_id='s')
        out = await io.stdout_str()
        assert out.endswith('parent:/w:original\n\n')
        if action == 'mutate' and terminator == '\\;':
            assert out == 'parent:/w\n' * 3 + 'parent:/w:original\n\n'
        assert await io.stderr_str() == ''
        assert io.exit_code == 0
    finally:
        await ws.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("action",
                         ['-exec touch marker \\;', '-print', '-delete'])
async def test_find_refuses_a_test_after_an_action_before_side_effects(action):
    ws = await _exec_ws()
    try:
        out, err, code = await _run_line(
            ws, f"find d {action} -name '*.txt' -print")
        assert (out, err, code) == (
            '', 'find: -name: tests after actions are not supported\n', 1)
        out, err, code = await _run_line(
            ws, 'test ! -e marker && test -e d/a.txt')
        assert code == 0
    finally:
        await ws.close()
