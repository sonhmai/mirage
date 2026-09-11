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

from mirage.shell.parse.heredoc.constants import (HEREDOC_BODY, HEREDOC_START,
                                                  SKIPPED_BLANKS)
from mirage.shell.parse.heredoc.line import operator_line_end


def body_prefix(redirect_node: tree_sitter.Node) -> str:
    """The opening bytes of a body that tree-sitter left out of its node.

    The scanner starts heredoc_body at the first byte it keeps, dropping
    every empty line before it and, when the shield could not run, the
    first kept line's indentation; bash keeps all of that. What lies
    between the operator's logical line and the body node is exactly
    that dropped run when it is blank, and is body text nowhere else, so
    a gap holding anything but blanks and newlines yields nothing.

    Args:
        redirect_node (tree_sitter.Node): a heredoc_redirect node.

    Returns:
        str: the dropped prefix, empty when the node starts where bash
        starts the body.
    """
    start = body = None
    for child in redirect_node.children:
        if child.type == HEREDOC_START:
            start = child
        elif child.type == HEREDOC_BODY:
            body = child
    if start is None or body is None:
        return ""
    text = redirect_node.text or b""
    base = redirect_node.start_byte
    line_end = operator_line_end(text, start.end_byte - base)
    if line_end is None:
        return ""
    gap = text[line_end + 1:body.start_byte - base]
    if not gap or any(byte not in SKIPPED_BLANKS for byte in gap):
        return ""
    return gap.decode()
