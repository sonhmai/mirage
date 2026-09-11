import re
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace

from mirage.commands.builtin.grep_select import WalkFilters
from mirage.io.async_line_iterator import AsyncLineIterator
from mirage.io.stream import close_quietly
from mirage.io.types import IOResult, materialize


@dataclass(frozen=True, slots=True)
class GrepFlags:
    """Parsed grep flags (TS FlagSet parity); the complete set grep honors."""
    ignore_case: bool
    invert: bool
    line_numbers: bool
    count_only: bool
    files_only: bool
    whole_word: bool
    fixed_string: bool
    basic_regexp: bool
    only_matching: bool
    quiet: bool
    recursive: bool
    with_filename: bool
    no_filename: bool
    max_count: int | None
    after_context: int
    before_context: int
    binary_mode: str
    filters: WalkFilters


# GNU grep's INITIAL_BUFSIZE: the window it examines before printing from it.
PROBE_BLOCK_BYTES = 96 * 1024


class BinaryInput:

    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.nul = False

    async def read(self, source: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
        """Probe the input for NUL a block at a time, then pass it on.

        GNU examines what one read() returned before printing from it: a
        whole buffer for a regular file, whatever had arrived for a pipe.
        A transport chunk is the pipe case, and it is not merged with later
        chunks because a -m1 over a row stream must not pull the rest of
        the collection to fill a window; a chunk a backend serves whole is
        cut into GNU-sized blocks so it behaves as the file case.

        Args:
            source (AsyncIterator[bytes]): the input as the backend serves it.
        """
        async for chunk in source:
            for offset in range(0, len(chunk), PROBE_BLOCK_BYTES):
                block = chunk[offset:offset + PROBE_BLOCK_BYTES]
                if self.stops(block):
                    return
                yield self.deliver(block)

    def stops(self, data: bytes) -> bool:
        """Note a NUL in data; True when without-match must stop reading.

        Args:
            data (bytes): bytes that all belong to the block being probed.
        """
        if self.mode != "text" and not self.nul and b"\0" in data:
            self.nul = True
        return self.nul and self.mode == "without-match"

    def deliver(self, block: bytes) -> bytes:
        return block.replace(b"\0", b"\n") if self.nul else block


async def binary_notice(io: IOResult, path: str) -> None:
    """Append GNU's binary-file notice to the input's stderr.

    Args:
        io (IOResult): the input's result.
        path (str): the name the notice carries.
    """
    io.stderr = (await materialize(
        io.stderr)) + f"grep: {path}: binary file matches\n".encode()


def valid_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def output_line(raw: bytes, number: int, selected: bool, path: str,
                show_filename: bool, f: GrepFlags) -> bytes:
    separator = b":" if selected else b"-"
    prefix = path.encode() + separator if show_filename else b""
    if f.line_numbers:
        prefix += str(number).encode() + separator
    return prefix + raw + b"\n"


async def grep_input(source: AsyncIterator[bytes],
                     pat: re.Pattern[str],
                     f: GrepFlags,
                     path: str,
                     show_filename: bool,
                     io: IOResult,
                     after_output: bool = False) -> AsyncIterator[bytes]:
    """Scan one input, yielding grep's output for it.

    Args:
        source (AsyncIterator[bytes]): the input's bytes.
        pat (re.Pattern[str]): the compiled pattern.
        f (GrepFlags): parsed flags.
        path (str): the name output lines carry.
        show_filename (bool): whether output lines carry the name.
        io (IOResult): receives the exit status and any notice.
        after_output (bool): whether an earlier input already printed
            lines; GNU then opens this input's first context group with
            the separator, as it does between groups within one input.
    """
    io.exit_code = 1
    pat = utf8_pattern(pat)
    binary = BinaryInput(f.binary_mode)
    count = 0
    notified = False
    previous: deque[tuple[int, bytes]] = deque(maxlen=f.before_context)
    last_printed = 0
    after_until = 0
    has_context = bool(f.after_context
                       or f.before_context) and not f.only_matching
    if f.max_count == 0:
        # Nothing is read, but the backend already opened the source.
        await close_quietly(source)
        if f.count_only and not (f.quiet or f.files_only):
            yield output_line(b"0", 0, True, path, show_filename,
                              replace(f, line_numbers=False))
        return
    number = 0
    input_stream = binary.read(source)
    try:
        async for raw in AsyncLineIterator(input_stream):
            if binary.nul and f.binary_mode == "without-match":
                break
            number += 1
            # Surrogate escapes preserve raw bytes under -a and -ao.
            line = raw.decode("utf-8", errors="surrogateescape")
            hit = bool(pat.search(line)) != f.invert
            if f.max_count is not None and count >= f.max_count:
                hit = False
            if hit:
                count += 1
                io.exit_code = 0
                if f.quiet:
                    return
                if f.files_only:
                    yield path.encode() + b"\n"
                    return
            if f.count_only:
                if f.max_count is not None and count >= f.max_count:
                    break
                continue
            chunks: list[bytes] = []
            if hit:
                if f.only_matching:
                    if not f.invert:
                        chunks = [
                            output_line(
                                m.group().encode("utf-8",
                                                 errors="surrogateescape"),
                                number, True, path, show_filename, f)
                            for m in pat.finditer(line) if m.group()
                        ]
                else:
                    if has_context:
                        pending = [(n, data) for n, data in previous
                                   if n > last_printed]
                        first = pending[0][0] if pending else number
                        if (last_printed and first > last_printed + 1) or (
                                not last_printed and after_output):
                            chunks.append(b"--\n")
                        chunks.extend(
                            output_line(data, n, False, path, show_filename, f)
                            for n, data in pending)
                    chunks.append(
                        output_line(raw, number, True, path, show_filename, f))
                    last_printed = number
                    after_until = number + f.after_context
            elif has_context and number <= after_until:
                chunks.append(
                    output_line(raw, number, False, path, show_filename, f))
                last_printed = number
            # A selected line with nothing to print (-o on a zero-width
            # match) still earns the notice.
            if hit and not chunks and binary.nul and (f.binary_mode == "binary"
                                                      and not notified):
                await binary_notice(io, path)
                notified = True
            for chunk in chunks:
                if f.binary_mode != "text" and (binary.nul
                                                or not valid_utf8(chunk)):
                    if f.binary_mode == "binary" and not notified:
                        await binary_notice(io, path)
                        notified = True
                    continue
                yield chunk
            if binary.nul and count and f.binary_mode == "binary":
                return
            previous.append((number, raw))
            if (f.max_count is not None and count >= f.max_count
                    and number >= after_until):
                break
    finally:
        await close_quietly(input_stream)
        await close_quietly(source)

    # Detection can end input without yielding another line.
    if binary.nul and f.binary_mode == "without-match":
        count = 0
        io.exit_code = 1

    if f.count_only and not (f.quiet or f.files_only):
        yield (f"{path}:"
               if show_filename else "").encode() + f"{count}\n".encode()


def utf8_pattern(pat: re.Pattern[str]) -> re.Pattern[str]:
    parts: list[str] = []
    escaped = False
    in_class = False
    class_start = 0
    for index, char in enumerate(pat.pattern):
        if escaped:
            parts.append(char)
            escaped = False
        elif char == "\\":
            parts.append(char)
            escaped = True
        elif char == "[" and not in_class:
            parts.append(char)
            in_class = True
            # A leading ] after an optional ^ is a class member.
            class_start = index + 1
            if pat.pattern[class_start:class_start + 1] == "^":
                class_start += 1
        elif char == "]" and in_class and index > class_start:
            parts.append(char)
            in_class = False
        elif char == "." and not in_class:
            parts.append(r"[^\n\udc80-\udcff]")
        else:
            parts.append(char)
    return re.compile("".join(parts), pat.flags)
