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

from mirage.shell.parse import parse
from mirage.shell.parse.heredoc import body_prefix
from mirage.shell.parse.parse import TS_PARSER

HEREDOC_REDIRECT = "heredoc_redirect"


def _redirect(root: tree_sitter.Node) -> tree_sitter.Node:
    stack = [root]
    while stack:
        node = stack.pop()
        if node.type == HEREDOC_REDIRECT:
            return node
        stack.extend(node.children)
    raise AssertionError("no heredoc_redirect in the tree")


def _prefix(command: str) -> str:
    return body_prefix(_redirect(parse(command)))


def test_body_prefix_is_empty_when_the_node_starts_the_body():
    assert _prefix("cat <<EOF\nfoo\nEOF\n") == ""


def test_body_prefix_is_the_leading_empty_line():
    assert _prefix("cat <<EOF\n\nfoo\nEOF\n") == "\n"


def test_body_prefix_is_every_leading_empty_line():
    assert _prefix("cat <<EOF\n\n\nfoo\nEOF\n") == "\n\n"


def test_body_prefix_before_a_backslash_line():
    assert _prefix("cat <<EOF\n\n\\first\nEOF\n") == "\n"


def test_body_prefix_of_a_body_that_is_one_empty_line():
    assert _prefix("cat <<EOF\n\nEOF\n") == "\n"


def test_body_prefix_after_a_pipeline_on_the_operator_line():
    assert _prefix("cat <<EOF | tr a-z A-Z\n\nfoo\nEOF\n") == "\n"


def test_body_prefix_after_a_comment_on_the_operator_line():
    assert _prefix("cat <<EOF # don't\n\nfoo\nEOF\n") == "\n"


def test_body_prefix_after_a_file_redirect():
    assert _prefix("cat > /data/x <<EOF\n\nfoo\nEOF\n") == "\n"


def test_body_prefix_under_dash():
    assert _prefix("cat <<-EOF\n\n\tfoo\nEOF\n") == "\n"


def test_body_prefix_leaves_a_blank_first_line_to_the_body():
    assert _prefix("cat <<EOF\n  \nfoo\nEOF\n") == ""


def test_body_prefix_is_the_indentation_an_unshielded_tree_skipped():
    cmd = "cat <<EOF\n  foo\nEOF\n"
    root = TS_PARSER.parse(cmd.encode()).root_node
    assert body_prefix(_redirect(root)) == "  "
