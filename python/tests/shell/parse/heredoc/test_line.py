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

import pytest

from mirage.shell.parse.heredoc import operator_line_end, quote_end


def _end(command: str, word: str = "EOF") -> int | None:
    data = command.encode()
    return operator_line_end(data, data.index(word.encode()) + len(word))


def test_line_ends_at_the_first_newline():
    assert _end("cat <<EOF\nbody\nEOF\n") == len("cat <<EOF")


def test_line_runs_past_a_pipeline():
    cmd = "cat <<EOF | tr a-z A-Z\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("\n")


def test_trailing_pipe_does_not_extend_the_line():
    # Bash gathers the body at this newline and reads the rest of the
    # pipeline after the terminator.
    cmd = "cat <<EOF |\nbody\nEOF\ntr a-z A-Z\n"
    assert _end(cmd) == cmd.index("\n")


def test_backslash_newline_continues_the_line():
    cmd = "cat <<EOF \\\n| tr a-z A-Z\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("A-Z\n") + 3


def test_comment_after_a_blank_hides_its_quote():
    cmd = "cat <<EOF # don't\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("'t\n") + 2


@pytest.mark.parametrize("separator",
                         [";", "|", "&&", "&", "(", ")", "<", ">"])
def test_comment_after_a_metacharacter_hides_its_quote(separator: str):
    cmd = f"cat <<EOF{separator}# don't\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("'t\n") + 2


def test_hash_inside_a_word_is_not_a_comment():
    cmd = "cat <<EOF a#b'\nc'\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("c'\n") + 2


def test_hash_after_a_dollar_is_not_a_comment():
    cmd = "cat <<EOF $#'\nc'\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("c'\n") + 2


def test_comment_inside_a_substitution_runs_to_its_own_newline():
    cmd = "cat <<EOF $(# don't\necho x)\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("x)\n") + 2


def test_ansi_c_quote_escapes_its_apostrophe():
    cmd = "cat <<EOF | grep $'it\\'s'\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("s'\n") + 2


def test_quoted_newline_is_not_the_line_end():
    cmd = "cat <<EOF | tr 'a\nb' x\nbody\nEOF\n"
    assert _end(cmd) == cmd.index(" x\n") + 2


def test_substitution_newline_is_not_the_line_end():
    cmd = "cat <<EOF | $(echo\ncat)\nbody\nEOF\n"
    assert _end(cmd) == cmd.index("cat)\n") + 4


def test_unterminated_quote_never_ends_the_line():
    assert _end("cat <<EOF | tr 'a\nbody\nEOF\n") is None


def test_line_without_a_newline_never_ends():
    assert _end("cat <<EOF") is None


def test_quote_end_skips_an_escaped_double_quote():
    assert quote_end(b'"a\\"b" c', 0) == 6


def test_quote_end_takes_a_backslash_literally_in_single_quotes():
    assert quote_end(b"'a\\' b", 0) == 4


def test_quote_end_honors_ansi_c_escapes():
    assert quote_end(b"$'a\\'b' c", 1) == 7


def test_quote_end_unterminated_is_none():
    assert quote_end(b'"abc', 0) is None
