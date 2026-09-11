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

import tree_sitter

BACKSLASH = 0x5C
NEWLINE = 0x0A
HASH = 0x23
DOLLAR = 0x24
LESS = 0x3C
GREATER = 0x3E
OPEN_PAREN = 0x28
CLOSE_PAREN = 0x29
SINGLE_QUOTE = 0x27
DOUBLE_QUOTE = 0x22
BACKTICK = 0x60
WORD_BLANKS = frozenset(b" \t")
LINE_BLANKS = frozenset(b" \t\r")
ESCAPE_PARTNERS = frozenset(b"$`\\")
FILLER = ord("x")
ALTERNATE_FILLER = ord("y")
HEREDOC_START = "heredoc_start"
DASH_ARROW = "<<-"


def clean_delimiter(token: str) -> str:
    """The delimiter word as bash reads it: quotes removed, escapes resolved.

    ``'EOF'``, ``"EOF"``, ``EN'D'`` and ``\\EOF`` all end their body at a
    line reading ``END`` or ``EOF``; the quoting only decides whether the
    body expands.

    Args:
        token (str): the heredoc_start token as typed.
    """
    out: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(token):
        char = token[index]
        if quote is not None:
            if char == quote:
                quote = None
            else:
                out.append(char)
        elif char in ("'", '"'):
            quote = char
        elif char == "\\" and index + 1 < len(token):
            index += 1
            out.append(token[index])
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _quote_end(data: bytes, start: int) -> int | None:
    """Offset just past the quote closing the one at ``start``.

    A backslash escapes the next byte inside double quotes and backticks,
    never inside single quotes.

    Args:
        data (bytes): the shell source.
        start (int): byte offset of the opening quote.
    """
    quote = data[start]
    index = start + 1
    while index < len(data):
        byte = data[index]
        if byte == BACKSLASH and quote != SINGLE_QUOTE:
            index += 2
            continue
        if byte == quote:
            return index + 1
        index += 1
    return None


def operator_line_end(data: bytes, start: int) -> int | None:
    """Offset of the newline ending the logical line the operator sits on.

    Read forward from the end of the delimiter word the way bash's reader
    does: a backslash escapes the next byte, so ``\\<newline>`` continues
    the line; quotes and backticks hide their contents; ``$(``, ``<(`` and
    ``>(`` run to their balancing paren; a ``#`` opening a word starts a
    comment that ends at the newline.

    Args:
        data (bytes): the shell source.
        start (int): byte offset just past the heredoc_start token.

    Returns:
        int | None: offset of the newline, or None when the line never
        ends.
    """
    depth = 0
    index = start
    while index < len(data):
        byte = data[index]
        if byte == BACKSLASH:
            index += 2
        elif byte in (SINGLE_QUOTE, DOUBLE_QUOTE, BACKTICK):
            end = _quote_end(data, index)
            if end is None:
                return None
            index = end
        elif (byte in (DOLLAR, LESS, GREATER)
              and data[index + 1:index + 2] == b"("):
            depth += 1
            index += 2
        elif byte == OPEN_PAREN and depth > 0:
            depth += 1
            index += 1
        elif byte == CLOSE_PAREN and depth > 0:
            depth -= 1
            index += 1
        elif byte == HASH and (index == start
                               or data[index - 1] in WORD_BLANKS):
            newline = data.find(b"\n", index)
            if newline < 0:
                return None
            if depth == 0:
                return newline
            index = newline + 1
        elif byte == NEWLINE and depth == 0:
            return index
        else:
            index += 1
    return None


def terminator_line(data: bytes, body_start: int, delimiter: bytes,
                    allows_indent: bool) -> int | None:
    """Offset where the line closing the body starts.

    Bash ends a body at the first line that equals the delimiter, with
    leading tabs stripped first under ``<<-``.

    Args:
        data (bytes): the shell source.
        body_start (int): byte offset of the body's first line.
        delimiter (bytes): the cleaned delimiter.
        allows_indent (bool): whether the operator was ``<<-``.

    Returns:
        int | None: the line's offset, or None when no line closes the
        body.
    """
    position = body_start
    while position <= len(data):
        newline = data.find(b"\n", position)
        line_end = len(data) if newline < 0 else newline
        line = data[position:line_end]
        if allows_indent:
            line = line.lstrip(b"\t")
        if line == delimiter:
            return position
        if newline < 0:
            return None
        position = newline + 1
    return None


def heredoc_body_range(data: bytes, start: int, delimiter: str,
                       allows_indent: bool) -> tuple[int, int] | None:
    """The byte span of a heredoc body, by bash's own rule.

    The body is every line strictly between the logical line carrying the
    operator and the line holding the delimiter, so it is a property of
    the source text, not of any token the parser produced.

    Args:
        data (bytes): the shell source.
        start (int): byte offset just past the heredoc_start token.
        delimiter (str): the cleaned delimiter.
        allows_indent (bool): whether the operator was ``<<-``.

    Returns:
        tuple[int, int] | None: ``(body_start, body_end)``, or None when
        the body never starts or never ends.
    """
    line_end = operator_line_end(data, start)
    if line_end is None:
        return None
    body_start = line_end + 1
    body_end = terminator_line(data, body_start, delimiter.encode(),
                               allows_indent)
    if body_end is None:
        return None
    return body_start, body_end


def _heredoc_starts(root: tree_sitter.Node) -> list[tree_sitter.Node]:
    """Every heredoc_start token under ``root``, in source order.

    ERROR subtrees are walked too: a body the lexer mangled badly enough
    leaves no heredoc_redirect behind, but its start token survives.

    Args:
        root (tree_sitter.Node): the parsed tree.
    """
    found: list[tree_sitter.Node] = []
    stack = [root]
    while stack:
        node = stack.pop()
        if node.type == HEREDOC_START:
            found.append(node)
        stack.extend(node.children)
    found.sort(key=lambda node: node.start_byte)
    return found


def _first_content_line(data: bytes, body_start: int,
                        body_end: int) -> int | None:
    """Offset of the first body line that is not empty.

    Args:
        data (bytes): the shell source.
        body_start (int): byte offset of the body's first line.
        body_end (int): byte offset of the terminator line.
    """
    position = body_start
    while position < body_end:
        newline = data.find(b"\n", position, body_end)
        line_end = body_end if newline < 0 else newline
        if line_end > position:
            return position
        position = line_end + 1
    return None


def protected_source(data: bytes, root: tree_sitter.Node) -> bytes | None:
    """``data`` with every heredoc body's first line made lexable.

    tree-sitter-bash decides where a heredoc body starts from the byte
    that follows the operator line, and gets it wrong for two shapes bash
    reads fine: leading whitespace is skipped, and a line opening with a
    backslash is lexed as more words of the operator line, so the line is
    lost from the body and, worse, lands in whatever construct was open
    (``tr a-z A-Z \\first``), or breaks the parse outright once it holds
    an apostrophe or a ``;``. Replacing that one byte (and the byte a
    backslash escapes, so ``\\$v`` cannot surface as an expansion) with a
    plain letter makes the scanner start the body exactly where bash
    does, without moving a single offset; the caller then reads the body
    back out of the untouched source.

    Args:
        data (bytes): the shell source.
        root (tree_sitter.Node): the tree parsed from ``data``.

    Returns:
        bytes | None: the protected source, or None when every body
        already lexes as bash reads it.
    """
    out = bytearray(data)
    changed = False
    bodies: list[tuple[int, int]] = []
    for start in _heredoc_starts(root):
        if any(begin <= start.start_byte < end for begin, end in bodies):
            continue
        delimiter = clean_delimiter((start.text or b"").decode())
        if not delimiter:
            continue
        previous = start.prev_sibling
        allows_indent = previous is not None and previous.type == DASH_ARROW
        span = heredoc_body_range(data, start.end_byte, delimiter,
                                  allows_indent)
        if span is None:
            continue
        bodies.append(span)
        line = _first_content_line(data, *span)
        if line is None:
            continue
        first = data[line]
        if first not in LINE_BLANKS and first != BACKSLASH:
            continue
        filler = (ALTERNATE_FILLER
                  if delimiter.startswith(chr(FILLER)) else FILLER)
        out[line] = filler
        changed = True
        if (first == BACKSLASH and line + 1 < span[1]
                and data[line + 1] in ESCAPE_PARTNERS):
            out[line + 1] = filler
    return bytes(out) if changed else None


def same_shape(left: tree_sitter.Node, right: tree_sitter.Node) -> bool:
    """Whether two trees agree on every node's type and byte span.

    Args:
        left (tree_sitter.Node): one tree's root.
        right (tree_sitter.Node): the other tree's root.
    """
    stack = [(left, right)]
    while stack:
        a, b = stack.pop()
        if (a.type != b.type or a.start_byte != b.start_byte
                or a.end_byte != b.end_byte or a.child_count != b.child_count):
            return False
        stack.extend(zip(a.children, b.children))
    return True
