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

from collections.abc import Sequence

from mirage.shell.parse.heredoc.line import operator_line_end
from mirage.shell.parse.heredoc.types import HeredocOperator


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


def next_line(data: bytes, line_start: int) -> int | None:
    """Offset of the line after the one starting at ``line_start``.

    Args:
        data (bytes): the shell source.
        line_start (int): byte offset of a line.

    Returns:
        int | None: the following line's offset, or None when this line
        is the last one and has no newline.
    """
    newline = data.find(b"\n", line_start)
    return None if newline < 0 else newline + 1


def heredoc_bodies(
        data: bytes,
        operators: Sequence[HeredocOperator]) -> list[tuple[int, int] | None]:
    """The body span of every operator, read the way bash reads them.

    Bash gathers bodies at the newline that ends an operator's logical
    line, one after another in the order the operators appear on it, so
    the second body of ``cat <<A <<B`` starts on the line after ``A``'s
    terminator. A body is every line strictly between where it starts
    and the line holding its delimiter, which makes the span a property
    of the source text, not of any token the parser produced. An
    operator that lies inside an earlier body is text, not syntax.

    Args:
        data (bytes): the shell source.
        operators (Sequence[HeredocOperator]): the operators, in any
            order.

    Returns:
        list[tuple[int, int] | None]: ``(body_start, body_end)`` for
        each operator, in the order given; None when the body never
        starts or never ends.
    """
    spans: list[tuple[int, int] | None] = [None] * len(operators)
    bodies: list[tuple[int, int]] = []
    previous_line_end: int | None = None
    cursor: int | None = None
    order = sorted(range(len(operators)),
                   key=lambda index: operators[index].word_start)
    for position in order:
        operator = operators[position]
        if any(begin <= operator.word_start < end for begin, end in bodies):
            continue
        line_end = operator_line_end(data, operator.word_end)
        if line_end is None:
            continue
        body_start = cursor if line_end == previous_line_end else line_end + 1
        previous_line_end = line_end
        cursor = None
        if body_start is None:
            continue
        body_end = terminator_line(data, body_start,
                                   operator.delimiter.encode(),
                                   operator.allows_indent)
        if body_end is None:
            continue
        spans[position] = (body_start, body_end)
        bodies.append((body_start, body_end))
        cursor = next_line(data, body_end)
    return spans
