// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

import type { TSNodeLike } from '../../types.ts'
import { HEREDOC_BODY, HEREDOC_START, SKIPPED_BLANKS } from './constants.ts'
import { operatorLineEnd } from './line.ts'

/**
 * The opening characters of a body that tree-sitter left out of its node.
 *
 * The scanner starts heredoc_body at the first character it keeps,
 * dropping every empty line before it and, when the shield could not
 * run, the first kept line's indentation; bash keeps all of that. What
 * lies between the operator's logical line and the body node is exactly
 * that dropped run when it is blank, and is body text nowhere else, so a
 * gap holding anything but blanks and newlines yields nothing. Returns
 * the empty string when the node starts where bash starts the body.
 */
export function bodyPrefix(redirectNode: TSNodeLike): string {
  let start: TSNodeLike | null = null
  let body: TSNodeLike | null = null
  for (const child of redirectNode.children) {
    if (child.type === HEREDOC_START) start = child
    else if (child.type === HEREDOC_BODY) body = child
  }
  const base = redirectNode.startIndex
  if (start === null || body === null || base === undefined) return ''
  if (start.endIndex === undefined || body.startIndex === undefined) return ''
  const text = redirectNode.text
  const lineEnd = operatorLineEnd(text, start.endIndex - base)
  if (lineEnd === null) return ''
  const gap = text.slice(lineEnd + 1, body.startIndex - base)
  if (gap === '') return ''
  for (const char of gap) {
    if (!SKIPPED_BLANKS.has(char)) return ''
  }
  return gap
}
