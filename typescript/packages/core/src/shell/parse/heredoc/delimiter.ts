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

import { DQUOTE_ESCAPABLE } from './constants.ts'

/**
 * The delimiter word as bash reads it: quotes removed, escapes resolved.
 *
 * `'EOF'`, `"EOF"`, `EN'D'` and `\EOF` all end their body at a line
 * reading `END` or `EOF`; the quoting only decides whether the body
 * expands. Quote removal follows the shell's own rules: a backslash
 * escapes anything outside quotes, nothing inside single quotes, and
 * only `$`, `` ` ``, `"` and itself inside double quotes, so `"E\$F"`
 * names `E$F` while `"E\xF"` keeps its backslash.
 */
export function cleanDelimiter(token: string): string {
  let out = ''
  let quote: string | null = null
  let index = 0
  while (index < token.length) {
    const char = token[index] ?? ''
    if (quote === "'") {
      if (char === "'") quote = null
      else out += char
    } else if (quote === '"') {
      if (char === '"') {
        quote = null
      } else if (
        char === '\\' &&
        index + 1 < token.length &&
        DQUOTE_ESCAPABLE.has(token[index + 1] ?? '')
      ) {
        index += 1
        out += token[index] ?? ''
      } else {
        out += char
      }
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '\\' && index + 1 < token.length) {
      index += 1
      out += token[index] ?? ''
    } else {
      out += char
    }
    index += 1
  }
  return out
}
