from collections.abc import AsyncIterator
from functools import partial

from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.chroma.glob import resolve_glob
from mirage.core.chroma.read import read_bytes, read_stream
from mirage.core.chroma.readdir import readdir
from mirage.core.chroma.stat import stat_light
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("rg", resource="chroma", spec=SPECS["rg"])
async def rg(
    accessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    index: IndexCacheStore = None,
    **flags: object,
) -> tuple[ByteSource | None, IOResult]:
    if paths:
        paths = await resolve_glob(accessor, paths, index)
    return await generic_rg(
        paths,
        texts,
        flags,
        readdir=readdir,
        stat=stat_light,
        read_bytes=read_bytes,
        read_stream=partial(read_stream, index=index),
        accessor=accessor,
        stdin=stdin,
        index=index,
    )
