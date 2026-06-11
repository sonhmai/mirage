from mirage.commands.builtin.generic.cat import cat as generic_cat
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.chroma.glob import resolve_glob
from mirage.core.chroma.read import read_bytes, read_stream
from mirage.io.cachable_iterator import CachableAsyncIterator
from mirage.io.stream import async_chain
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("cat", resource="chroma", spec=SPECS["cat"])
async def cat(
    accessor,
    paths: list[PathSpec],
    *texts: str,
    n: bool = False,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    index = _extra.get("index")
    paths = await resolve_glob(accessor, paths, index)
    if len(paths) == 1:
        p = paths[0]
        cachable = CachableAsyncIterator(read_stream(accessor, p, index))
        io = IOResult(reads={p.strip_prefix: cachable}, cache=[p.strip_prefix])
        source: ByteSource = cachable
    else:
        reads: dict[str, ByteSource] = {}
        parts: list[bytes] = []
        for p in paths:
            data = await read_bytes(accessor, p, index)
            reads[p.strip_prefix] = data
            parts.append(data)
        io = IOResult(reads=reads, cache=list(reads))
        source = async_chain(*parts)
    if n:
        return generic_cat(source, number_lines=True), io
    return source, io
