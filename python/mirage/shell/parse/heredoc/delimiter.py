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

from mirage.shell.parse.heredoc.constants import DQUOTE_ESCAPABLE


def clean_delimiter(token: str) -> str:
    """The delimiter word as bash reads it: quotes removed, escapes resolved.

    ``'EOF'``, ``"EOF"``, ``EN'D'`` and ``\\EOF`` all end their body at a
    line reading ``END`` or ``EOF``; the quoting only decides whether the
    body expands. Quote removal follows the shell's own rules: a
    backslash escapes anything outside quotes, nothing inside single
    quotes, and only ``$``, `````, ``"`` and itself inside double quotes,
    so ``"E\\$F"`` names ``E$F`` while ``"E\\xF"`` keeps its backslash.

    Args:
        token (str): the heredoc_start token as typed.
    """
    out: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(token):
        char = token[index]
        if quote == "'":
            if char == "'":
                quote = None
            else:
                out.append(char)
        elif quote == '"':
            if char == '"':
                quote = None
            elif (char == "\\" and index + 1 < len(token)
                  and token[index + 1] in DQUOTE_ESCAPABLE):
                index += 1
                out.append(token[index])
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
