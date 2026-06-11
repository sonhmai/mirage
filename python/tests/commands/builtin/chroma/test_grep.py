import pytest

from mirage.commands.builtin.chroma.grep import grep
from mirage.io.types import materialize
from mirage.types import PathSpec

DOCS = {
    "/knowledge/a.md": b"alpha match\nbeta\n",
    "/knowledge/b.md": b"gamma match\n",
}


def _spec(path: str) -> PathSpec:
    return PathSpec.from_str_path(path, "/knowledge/")


def _patch_pushdown(monkeypatch, targets: dict[str, str],
                    matched: list[str]) -> list[tuple]:
    calls: list[tuple] = []
    g = grep.__wrapped__.__globals__

    async def fake_resolve_glob(accessor, paths, index):
        return paths

    async def fake_target_slugs(accessor, paths, index):
        return targets

    async def fake_coarse(accessor, pattern, t, *, ignore_case, invert,
                          fixed_string):
        calls.append((pattern, ignore_case, invert, fixed_string))
        return matched

    def fake_read_stream(accessor, p, index=None):
        return _stream_doc(p.original)

    async def fake_read_bytes(accessor, p, index=None):
        return DOCS[p.original]

    monkeypatch.setitem(g, "resolve_glob", fake_resolve_glob)
    monkeypatch.setitem(g, "target_slugs", fake_target_slugs)
    monkeypatch.setitem(g, "coarse_filter_slugs", fake_coarse)
    monkeypatch.setitem(g, "read_stream", fake_read_stream)
    monkeypatch.setitem(g, "read_bytes", fake_read_bytes)
    return calls


async def _stream_doc(path: str):
    yield DOCS[path]


@pytest.mark.asyncio
async def test_single_file_prints_bare_lines(monkeypatch):
    calls = _patch_pushdown(monkeypatch, {"/knowledge/a.md": "a"}, ["a"])

    output, io = await grep(object(), [_spec("/knowledge/a.md")],
                            "match",
                            index=None)

    assert await materialize(output) == b"alpha match\n"
    assert io.exit_code == 0
    assert calls == [("match", False, False, False)]


@pytest.mark.asyncio
async def test_filtered_out_skips_reads_and_exits_one(monkeypatch):
    _patch_pushdown(monkeypatch, {"/knowledge/a.md": "a"}, [])

    output, io = await grep(object(), [_spec("/knowledge/a.md")],
                            "absent",
                            index=None)

    assert output == b""
    assert io.exit_code == 1


@pytest.mark.asyncio
async def test_multi_target_prefixes_filenames(monkeypatch):
    _patch_pushdown(monkeypatch, {
        "/knowledge/a.md": "a",
        "/knowledge/b.md": "b"
    }, ["a", "b"])

    output, io = await grep(
        object(), [_spec("/knowledge/a.md"),
                   _spec("/knowledge/b.md")],
        "match",
        index=None)

    assert await materialize(output) == (b"/knowledge/a.md:alpha match\n"
                                         b"/knowledge/b.md:gamma match\n")
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_pushdown_prunes_but_keeps_prefix(monkeypatch):
    _patch_pushdown(monkeypatch, {
        "/knowledge/a.md": "a",
        "/knowledge/b.md": "b"
    }, ["b"])

    output, io = await grep(
        object(), [_spec("/knowledge/a.md"),
                   _spec("/knowledge/b.md")],
        "gamma",
        index=None)

    assert await materialize(output) == b"/knowledge/b.md:gamma match\n"
    assert io.exit_code == 0
