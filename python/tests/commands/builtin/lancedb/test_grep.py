import pytest

from mirage.commands.builtin.lancedb.grep import grep
from mirage.io.types import materialize
from mirage.types import FileStat, FileType, PathSpec

DOCS = {
    "/db/animals/cat/1.md": b"alpha match\nctx one\nctx two\n",
    "/db/animals/dog/2.md": b"gamma match\n",
}

DIRS = {
    "/db/animals": ["/db/animals/cat", "/db/animals/dog"],
    "/db/animals/cat": ["/db/animals/cat/1.md"],
    "/db/animals/dog": ["/db/animals/dog/2.md"],
}


def _spec(path: str) -> PathSpec:
    return PathSpec.from_str_path(path, "/db/")


def _patch_backend(monkeypatch) -> None:
    g = grep.__wrapped__.__globals__

    async def fake_resolve_glob(accessor, paths, index=None):
        return paths

    async def fake_read(accessor, p, index=None):
        return DOCS[p.original]

    async def fake_readdir(accessor, p, index=None):
        return DIRS[p.original]

    async def fake_stat(accessor, p, index=None):
        kind = FileType.DIRECTORY if p.original in DIRS else FileType.TEXT
        return FileStat(name=p.original, type=kind)

    monkeypatch.setitem(g, "resolve_glob", fake_resolve_glob)
    monkeypatch.setitem(g, "lancedb_read", fake_read)
    monkeypatch.setitem(g, "_readdir", fake_readdir)
    monkeypatch.setitem(g, "_stat", fake_stat)


async def _stdin() -> bytes:
    return b"alpha line\nbeta line\n"


@pytest.mark.asyncio
async def test_single_file_prints_bare_lines(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(object(), [_spec("/db/animals/cat/1.md")],
                            "match",
                            index=None)

    assert await materialize(output) == b"alpha match\n"
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_multi_file_prefixes_filenames(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(
        object(),
        [_spec("/db/animals/cat/1.md"),
         _spec("/db/animals/dog/2.md")],
        "match",
        index=None)

    assert await materialize(output) == (b"/db/animals/cat/1.md:alpha match\n"
                                         b"/db/animals/dog/2.md:gamma match\n")
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_quiet_suppresses_output(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(object(), [_spec("/db/animals/cat/1.md")],
                            "match",
                            q=True,
                            index=None)

    assert await materialize(output) == b""
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_after_context_includes_trailing_lines(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(object(), [_spec("/db/animals/cat/1.md")],
                            "match",
                            A="1",
                            index=None)

    assert await materialize(output) == b"alpha match\nctx one\n"
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_stdin_searched_when_no_paths(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(object(), [],
                            "alpha",
                            stdin=await _stdin(),
                            index=None)

    assert await materialize(output) == b"alpha line\n"
    assert io.exit_code == 0


@pytest.mark.asyncio
async def test_recursive_searches_all_paths(monkeypatch):
    _patch_backend(monkeypatch)

    output, io = await grep(
        object(), [_spec("/db/animals/cat"),
                   _spec("/db/animals/dog")],
        "match",
        r=True,
        index=None)

    assert await materialize(output) == (b"/db/animals/cat/1.md:alpha match\n"
                                         b"/db/animals/dog/2.md:gamma match\n")
    assert io.exit_code == 0
