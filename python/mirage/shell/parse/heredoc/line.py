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

from mirage.shell.parse.heredoc import constants


def quote_end(data: bytes, start: int) -> int | None:
    """Offset just past the quote closing the one at ``start``.

    A backslash escapes the next byte inside double quotes, backticks
    and ``$'...'``, never inside a plain single-quoted string.

    Args:
        data (bytes): the shell source.
        start (int): byte offset of the opening quote.
    """
    quote = data[start]
    escapes = quote != constants.SINGLE_QUOTE or data[start - 1:start] == b"$"
    index = start + 1
    while index < len(data):
        byte = data[index]
        if byte == constants.BACKSLASH and escapes:
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
    ``>(`` run to their balancing paren and ``${`` to its balancing brace,
    both across newlines, since no body is read until the word holding
    them is whole; a ``#`` opening a word, which is one after a blank or a
    metacharacter (``cat <<EOF;# don't``), starts a comment that ends at
    the newline. The constructs still open are kept as the closers they
    want, innermost last, because a ``#`` opens a comment only where a
    command may start: inside ``$( )`` it does, inside ``${ }`` it is part
    of the word (``${x:- #y}`` expands to `` #y``). A trailing ``|`` or
    ``&&`` does not extend the line: bash gathers the body at the first
    newline and reads the rest of the pipeline after the terminator.

    Args:
        data (bytes): the shell source.
        start (int): byte offset just past the heredoc_start token.

    Returns:
        int | None: offset of the newline, or None when the line never
        ends.
    """
    closers: list[int] = []
    index = start
    while index < len(data):
        byte = data[index]
        top = closers[-1] if closers else None
        if byte == constants.BACKSLASH:
            index += 2
        elif byte in constants.QUOTE_OPENERS:
            end = quote_end(data, index)
            if end is None:
                return None
            index = end
        elif data[index:index + 2] == b"${":
            closers.append(constants.CLOSE_BRACE)
            index += 2
        elif (byte in constants.SUBSTITUTION_OPENERS
              and data[index + 1:index + 2] == b"("):
            closers.append(constants.CLOSE_PAREN)
            index += 2
        elif byte == constants.OPEN_PAREN and top == constants.CLOSE_PAREN:
            closers.append(constants.CLOSE_PAREN)
            index += 1
        elif byte == top:
            closers.pop()
            index += 1
        elif (byte == constants.HASH and index > 0
              and data[index - 1] in constants.COMMENT_PRECEDERS
              and top != constants.CLOSE_BRACE):
            newline = data.find(b"\n", index)
            if newline < 0:
                return None
            if not closers:
                return newline
            index = newline + 1
        elif byte == constants.NEWLINE and not closers:
            return index
        else:
            index += 1
    return None
