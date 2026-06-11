from functools import partial

from mirage.commands.builtin.generic.grep import grep as generic_grep
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.chroma.glob import resolve_glob
from mirage.core.chroma.grep import coarse_filter_slugs, target_slugs
from mirage.core.chroma.read import read_bytes, read_stream
from mirage.core.chroma.readdir import readdir
from mirage.core.chroma.stat import stat_light
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("grep", resource="chroma", spec=SPECS["grep"])
async def grep(
    accessor,
    paths: list[PathSpec],
    *texts: str,
    r: bool = False,
    R: bool = False,
    i: bool = False,
    args_i: bool = False,
    v: bool = False,
    n: bool = False,
    c: bool = False,
    args_l: bool = False,
    w: bool = False,
    F: bool = False,
    E: bool = False,
    o: bool = False,
    m: str | None = None,
    q: bool = False,
    H: bool = False,
    args_h: bool = False,
    A: str | None = None,
    B: str | None = None,
    C: str | None = None,
    e: str | None = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    index = _extra.get("index")
    paths = await resolve_glob(accessor, paths, index)
    if e is not None:
        pattern = e
    elif texts:
        pattern = texts[0]
    else:
        raise ValueError("grep: usage: grep [flags] pattern [path]")
    files = paths
    show_filename = False
    if paths:
        # Pushdown: expand the scope to files and let ChromaDB pre-filter
        # which documents can contain the pattern, so only candidate
        # documents are fetched. The generic grep owns flag handling and
        # output formatting on the surviving files.
        targets = await target_slugs(accessor, paths, index)
        matched = set(await coarse_filter_slugs(accessor,
                                                pattern,
                                                targets,
                                                ignore_case=i or args_i,
                                                invert=v,
                                                fixed_string=F))
        prefix = paths[0].prefix
        files = [
            PathSpec.from_str_path(p, prefix) for p, slug in targets.items()
            if slug in matched
        ]
        if not files:
            return b"", IOResult(exit_code=1)
        show_filename = r or R or len(paths) > 1 or len(targets) > 1
    return await generic_grep(
        files,
        pattern=pattern,
        readdir=readdir,
        stat=stat_light,
        read_bytes=read_bytes,
        read_stream=partial(read_stream, index=index),
        accessor=accessor,
        ignore_case=i or args_i,
        invert=v,
        line_numbers=n,
        count_only=c,
        files_only=args_l,
        whole_word=w,
        fixed_string=F,
        only_matching=o,
        quiet=q,
        recursive=False,
        max_count=int(m) if m is not None else None,
        after_context=int(A) if A is not None else
        (int(C) if C is not None else 0),
        before_context=int(B) if B is not None else
        (int(C) if C is not None else 0),
        show_filename=show_filename,
        index=index,
    )
