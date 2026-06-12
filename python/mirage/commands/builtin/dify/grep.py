from functools import partial

from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.grep import grep as generic_grep
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.dify.glob import resolve_glob
from mirage.core.dify.read import read_bytes, read_stream
from mirage.core.dify.readdir import readdir
from mirage.core.dify.stat import stat
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("grep", resource="dify", spec=SPECS["grep"])
async def grep(
    accessor,
    paths: list[PathSpec],
    *texts: str,
    index: IndexCacheStore = None,
    **flags: object,
) -> tuple[ByteSource | None, IOResult]:
    paths = await resolve_glob(accessor, paths, index)
    return await generic_grep(
        paths,
        texts,
        flags,
        readdir=readdir,
        stat=stat,
        read_bytes=read_bytes,
        read_stream=partial(read_stream, index=index),
        accessor=accessor,
        index=index,
    )
