import gzip as gziplib
import re
from collections.abc import (AsyncIterator, Awaitable, Callable, Mapping,
                             Sequence)
from functools import partial

from mirage.commands.builtin.generic.grep import resolve_pattern
from mirage.commands.builtin.grep_helper import build_pattern_str
from mirage.commands.builtin.utils.lines import split_lines
from mirage.commands.builtin.utils.stream import _read_stdin_async
from mirage.commands.spec.types import FlagView
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


async def _read_plain(
    read_bytes: Callable[..., Awaitable[bytes]],
    accessor: object,
    path: PathSpec,
    index: object = None,
) -> bytes:
    return await read_bytes(accessor, path)


def _zgrep_search(
    data: bytes,
    pattern: str,
    ignore_case: bool,
    invert: bool,
    count: bool,
    line_numbers: bool,
    filename: str | None,
    only_matching: bool,
    max_count: int | None,
) -> tuple[list[str], bool]:
    text = data.decode(errors="replace")
    lines = split_lines(text)
    flags = re.IGNORECASE if ignore_case else 0
    matched: list[tuple[int, str]] = []
    for idx, line in enumerate(lines, 1):
        if only_matching and not invert:
            hits = list(re.finditer(pattern, line, flags))
            if hits:
                for m in hits:
                    matched.append((idx, m.group()))
                    if max_count is not None and len(matched) >= max_count:
                        break
            elif invert:
                matched.append((idx, line))
        else:
            hit = bool(re.search(pattern, line, flags))
            if invert:
                hit = not hit
            if hit:
                matched.append((idx, line))
        if max_count is not None and len(matched) >= max_count:
            break
    if count:
        return [str(len(matched))], len(matched) > 0
    result: list[str] = []
    for idx, line in matched:
        prefix = ""
        if filename:
            prefix = filename + ":"
        if line_numbers:
            prefix += str(idx) + ":"
        result.append(prefix + line)
    return result, len(matched) > 0


def _files_only_match(data: bytes, pattern: str, ignore_case: bool,
                      invert: bool) -> bool:
    text = data.decode(errors="replace")
    flags = re.IGNORECASE if ignore_case else 0
    for line in split_lines(text):
        hit = bool(re.search(pattern, line, flags))
        if invert:
            hit = not hit
        if hit:
            return True
    return False


async def zgrep(
    paths: list[PathSpec],
    texts: Sequence[str] = (),
    flags: Mapping[str, object] | None = None,
    *,
    read_bytes: Callable[..., Awaitable[bytes]],
    accessor: object = None,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    index: object = None,
) -> tuple[ByteSource | None, IOResult]:
    fl = FlagView(flags)
    pattern, never_match = await resolve_pattern(
        texts, fl, partial(_read_plain, read_bytes), accessor, index,
        "zgrep: usage: zgrep [flags] pattern [path]")
    ignore_case = fl.bool("i")
    invert = fl.bool("v")
    count = fl.bool("c")
    files_only = fl.bool("args_l")
    line_numbers = fl.bool("n")
    fixed = fl.bool("F") and not never_match
    force_filename = fl.bool("H")
    suppress_filename = fl.bool("h")
    only_matching = fl.bool("o")
    quiet = fl.bool("q")
    whole_word = fl.bool("w")
    max_count = fl.int("m")
    compiled = build_pattern_str(pattern, fixed, whole_word)
    multi = len(paths) > 1
    show_filename = force_filename or (multi and not suppress_filename)
    any_match = False
    all_results: list[str] = []

    if paths:
        for p in paths:
            raw = await read_bytes(accessor, p)
            data = gziplib.decompress(raw)
            fname = p.original if show_filename else None
            if files_only:
                if _files_only_match(data, compiled, ignore_case, invert):
                    all_results.append(p.original)
                    any_match = True
            else:
                result, had_match = _zgrep_search(data, compiled, ignore_case,
                                                  invert, count, line_numbers,
                                                  fname, only_matching,
                                                  max_count)
                if had_match:
                    any_match = True
                all_results.extend(result)
    else:
        raw = await _read_stdin_async(stdin)
        if raw is None:
            raise ValueError("zgrep: missing input")
        data = gziplib.decompress(raw)
        if files_only:
            if _files_only_match(data, compiled, ignore_case, invert):
                all_results.append("(standard input)")
                any_match = True
        else:
            result, had_match = _zgrep_search(data, compiled, ignore_case,
                                              invert, count, line_numbers,
                                              None, only_matching, max_count)
            if had_match:
                any_match = True
            all_results.extend(result)

    if quiet:
        return None, IOResult(exit_code=0 if any_match else 1)
    if not any_match:
        return None, IOResult(exit_code=1)
    return ("\n".join(all_results) + "\n").encode(), IOResult()


__all__ = ["zgrep"]
