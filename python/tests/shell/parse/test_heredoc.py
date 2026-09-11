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
import tree_sitter

from mirage.shell.parse.heredoc import (clean_delimiter, heredoc_body_range,
                                        protected_source, same_shape)
from mirage.shell.parse.parse import TS_PARSER


def _root(command: str) -> tree_sitter.Node:
    return TS_PARSER.parse(command.encode()).root_node


def _diff(before: str, after: bytes) -> list[tuple[int, str]]:
    """The (offset, replacement) pairs by which ``after`` differs."""
    return [(i, chr(b)) for i, (a, b) in enumerate(zip(before.encode(), after))
            if a != b]


@pytest.mark.parametrize("token, expected", [
    ("EOF", "EOF"),
    ("'EOF'", "EOF"),
    ('"EOF"', "EOF"),
    ("EN'D'", "END"),
    ("\\EOF", "EOF"),
    ("E\\OF", "EOF"),
    ("'EO F'", "EO F"),
])
def test_clean_delimiter(token: str, expected: str):
    assert clean_delimiter(token) == expected


def _range(command: str, delimiter: str = "EOF", dash: bool = False):
    data = command.encode()
    start = data.index(b"<<") + (3 if dash else 2)
    start += len(data[start:].split(b"\n", 1)[0].split(b" ", 1)[0])
    return heredoc_body_range(data, start, delimiter, dash)


def test_body_range_plain():
    assert _range("cat <<EOF\nbody\nEOF\n") == (10, 15)


def test_body_range_ends_at_terminator_without_trailing_newline():
    assert _range("cat <<EOF\nbody\nEOF") == (10, 15)


def test_body_range_after_pipeline_on_operator_line():
    cmd = "cat <<EOF | tr a-z A-Z\nbody\nEOF\n"
    assert _range(cmd) == (cmd.index("body"), cmd.index("EOF\n", 10))


def test_body_range_honors_line_continuation():
    cmd = "cat <<EOF \\\n| tr a-z A-Z\nbody\nEOF\n"
    assert _range(cmd) == (cmd.index("body"), cmd.rindex("EOF"))


def test_body_range_comment_may_hold_a_quote():
    cmd = "cat <<EOF # don't\nbody\nEOF\n"
    assert _range(cmd) == (cmd.index("body"), cmd.rindex("EOF"))


def test_body_range_quoted_newline_is_not_the_line_end():
    cmd = "cat <<EOF | tr 'a\nb' x\nbody\nEOF\n"
    assert _range(cmd) == (cmd.index("body"), cmd.rindex("EOF"))


def test_body_range_substitution_newline_is_not_the_line_end():
    cmd = "cat <<EOF | $(echo\ncat)\nbody\nEOF\n"
    assert _range(cmd) == (cmd.index("body"), cmd.rindex("EOF"))


def test_body_range_dash_allows_tab_indented_terminator():
    cmd = "cat <<-EOF\n\tbody\n\tEOF\n"
    assert _range(cmd, dash=True) == (cmd.index("\tbody"), cmd.index("\tEOF"))


def test_body_range_dash_ignores_space_indented_terminator():
    assert _range("cat <<-EOF\n  body\n  EOF\n", dash=True) is None


def test_body_range_unterminated_is_none():
    assert _range("cat <<EOF\nbody\nmore\n") is None


def test_body_range_without_body_line_is_none():
    assert _range("cat <<EOF") is None


def test_body_range_matches_unquoted_delimiter():
    cmd = "cat <<EN'D'\nbody\nEND\n"
    assert _range(cmd,
                  delimiter="END") == (cmd.index("body"), cmd.rindex("END"))


def test_protected_source_is_none_when_the_body_lexes_already():
    cmd = "cat <<EOF\nfirst\nsecond\nEOF\n"
    assert protected_source(cmd.encode(), _root(cmd)) is None


def test_protected_source_masks_a_leading_backslash():
    cmd = "cat <<'EOF'\n\\first\nsecond\nEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\\first"), "x")]


def test_protected_source_masks_the_escaped_partner_too():
    cmd = "cat <<EOF\n\\$v\nsecond\nEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    at = cmd.index("\\$v")
    assert _diff(cmd, out) == [(at, "x"), (at + 1, "x")]


def test_protected_source_masks_leading_indentation():
    cmd = "cat <<'EOF'\n  first\nsecond\nEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("  first"), "x")]


def test_protected_source_skips_blank_lines_before_the_first_content_line():
    cmd = "cat <<'EOF'\n\n\\first\nsecond\nEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\\first"), "x")]


def test_protected_source_avoids_the_delimiters_first_letter():
    cmd = "cat <<xfirst\n\\first\nsecond\nxfirst\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\\first"), "y")]


def test_protected_source_handles_every_heredoc_on_the_line_list():
    cmd = "cat <<A\n\\one\nA\ncat <<B\n\\two\nB\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\\one"), "x"),
                               (cmd.index("\\two"), "x")]


def test_protected_source_ignores_an_operator_inside_a_body():
    # The swallowed first line spells `<<X`; body text is not syntax.
    cmd = "cat <<EOF\n\\a <<X\nsecond\nEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\\a"), "x")]


def test_protected_source_dash_masks_the_leading_tab():
    cmd = "cat <<-'EOF'\n\t\\first\n\tsecond\n\tEOF\n"
    out = protected_source(cmd.encode(), _root(cmd))
    assert out is not None
    assert _diff(cmd, out) == [(cmd.index("\t\\first"), "x")]


def test_protected_source_leaves_an_unterminated_heredoc_alone():
    cmd = "cat <<EOF\n\\first\nsecond\n"
    assert protected_source(cmd.encode(), _root(cmd)) is None


def test_same_shape_true_for_equal_parses():
    assert same_shape(_root("echo a | grep b"), _root("echo a | grep b"))


def test_same_shape_false_for_a_different_tree():
    assert not same_shape(_root("echo a | grep b"), _root("echo a; grep b"))


def test_same_shape_false_when_a_span_moves():
    assert not same_shape(_root("echo ab"), _root("echo abc"))
