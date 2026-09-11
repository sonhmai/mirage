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

import { COMMENT_PRECEDERS, QUOTE_OPENERS, SUBSTITUTION_OPENERS } from './constants.ts'

/**
 * Offset just past the quote closing the one at `start`.
 *
 * A backslash escapes the next character inside double quotes, backticks
 * and `$'...'`, never inside a plain single-quoted string.
 */
export function quoteEnd(text: string, start: number): number | null {
  const quote = text[start]
  const escapes = quote !== "'" || text[start - 1] === '$'
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\' && escapes) {
      index += 2
      continue
    }
    if (char === quote) return index + 1
    index += 1
  }
  return null
}

/**
 * Offset of the newline ending the logical line the operator sits on.
 *
 * Read forward from the end of the delimiter word the way bash's reader
 * does: a backslash escapes the next character, so `\<newline>` continues
 * the line; quotes and backticks hide their contents; `$(`, `<(` and `>(`
 * run to their balancing paren and `${` to its balancing brace, both
 * across newlines, since no body is read until the word holding them is
 * whole; a `#` opening a word, which is one after a blank or a
 * metacharacter (`cat <<EOF;# don't`), starts a comment that ends at the
 * newline. The constructs still open are kept as the closers they want,
 * innermost last, because a `#` opens a comment only where a command may
 * start: inside `$( )` it does, inside `${ }` it is part of the word
 * (`${x:- #y}` expands to ` #y`). A trailing `|` or `&&` does not extend
 * the line: bash gathers the body at the first newline and reads the rest
 * of the pipeline after the terminator. Returns null when the line never
 * ends.
 */
export function operatorLineEnd(text: string, start: number): number | null {
  const closers: string[] = []
  let index = start
  while (index < text.length) {
    const char = text[index] ?? ''
    const top = closers[closers.length - 1]
    if (char === '\\') {
      index += 2
    } else if (QUOTE_OPENERS.has(char)) {
      const end = quoteEnd(text, index)
      if (end === null) return null
      index = end
    } else if (char === '$' && text[index + 1] === '{') {
      closers.push('}')
      index += 2
    } else if (SUBSTITUTION_OPENERS.has(char) && text[index + 1] === '(') {
      closers.push(')')
      index += 2
    } else if (char === '(' && top === ')') {
      closers.push(')')
      index += 1
    } else if (top !== undefined && char === top) {
      closers.pop()
      index += 1
    } else if (
      char === '#' &&
      index > 0 &&
      COMMENT_PRECEDERS.has(text[index - 1] ?? '') &&
      top !== '}'
    ) {
      const newline = text.indexOf('\n', index)
      if (newline < 0) return null
      if (closers.length === 0) return newline
      index = newline + 1
    } else if (char === '\n' && closers.length === 0) {
      return index
    } else {
      index += 1
    }
  }
  return null
}
