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

import type { Node } from 'web-tree-sitter'

const WORD_BLANKS: ReadonlySet<string> = new Set([' ', '\t'])
const LINE_BLANKS: ReadonlySet<string> = new Set([' ', '\t', '\r'])
const ESCAPE_PARTNERS: ReadonlySet<string> = new Set(['$', '`', '\\'])
const SUBSTITUTION_OPENERS: ReadonlySet<string> = new Set(['$', '<', '>'])
const FILLER = 'x'
const ALTERNATE_FILLER = 'y'
const HEREDOC_START = 'heredoc_start'
const DASH_ARROW = '<<-'

/**
 * The delimiter word as bash reads it: quotes removed, escapes resolved.
 *
 * `'EOF'`, `"EOF"`, `EN'D'` and `\EOF` all end their body at a line
 * reading `END` or `EOF`; the quoting only decides whether the body
 * expands.
 */
export function cleanDelimiter(token: string): string {
  let out = ''
  let quote: string | null = null
  let index = 0
  while (index < token.length) {
    const char = token[index] ?? ''
    if (quote !== null) {
      if (char === quote) quote = null
      else out += char
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

// Offset just past the quote closing the one at `start`. A backslash
// escapes the next character inside double quotes and backticks, never
// inside single quotes.
function quoteEnd(text: string, start: number): number | null {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\' && quote !== "'") {
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
 * run to their balancing paren; a `#` opening a word starts a comment
 * that ends at the newline. Returns null when the line never ends.
 */
export function operatorLineEnd(text: string, start: number): number | null {
  let depth = 0
  let index = start
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === '\\') {
      index += 2
    } else if (char === "'" || char === '"' || char === '`') {
      const end = quoteEnd(text, index)
      if (end === null) return null
      index = end
    } else if (SUBSTITUTION_OPENERS.has(char) && text[index + 1] === '(') {
      depth += 1
      index += 2
    } else if (char === '(' && depth > 0) {
      depth += 1
      index += 1
    } else if (char === ')' && depth > 0) {
      depth -= 1
      index += 1
    } else if (char === '#' && (index === start || WORD_BLANKS.has(text[index - 1] ?? ''))) {
      const newline = text.indexOf('\n', index)
      if (newline < 0) return null
      if (depth === 0) return newline
      index = newline + 1
    } else if (char === '\n' && depth === 0) {
      return index
    } else {
      index += 1
    }
  }
  return null
}

/**
 * Offset where the line closing the body starts, or null when no line
 * does. Bash ends a body at the first line that equals the delimiter,
 * with leading tabs stripped first under `<<-`.
 */
export function terminatorLine(
  text: string,
  bodyStart: number,
  delimiter: string,
  allowsIndent: boolean,
): number | null {
  let position = bodyStart
  while (position <= text.length) {
    const newline = text.indexOf('\n', position)
    const lineEnd = newline < 0 ? text.length : newline
    let line = text.slice(position, lineEnd)
    if (allowsIndent) line = line.replace(/^\t+/, '')
    if (line === delimiter) return position
    if (newline < 0) return null
    position = newline + 1
  }
  return null
}

/**
 * The span of a heredoc body, by bash's own rule.
 *
 * The body is every line strictly between the logical line carrying the
 * operator and the line holding the delimiter, so it is a property of
 * the source text, not of any token the parser produced. Returns null
 * when the body never starts or never ends.
 */
export function heredocBodyRange(
  text: string,
  start: number,
  delimiter: string,
  allowsIndent: boolean,
): [number, number] | null {
  const lineEnd = operatorLineEnd(text, start)
  if (lineEnd === null) return null
  const bodyStart = lineEnd + 1
  const bodyEnd = terminatorLine(text, bodyStart, delimiter, allowsIndent)
  if (bodyEnd === null) return null
  return [bodyStart, bodyEnd]
}

// Every heredoc_start token under `root`, in source order. ERROR
// subtrees are walked too: a body the lexer mangled badly enough leaves
// no heredoc_redirect behind, but its start token survives.
function heredocStarts(root: Node): Node[] {
  const found: Node[] = []
  const stack: Node[] = [root]
  for (;;) {
    const node = stack.pop()
    if (node === undefined) break
    if (node.type === HEREDOC_START) found.push(node)
    stack.push(...node.children)
  }
  return found.sort((a, b) => a.startIndex - b.startIndex)
}

// Offset of the first body line that is not empty.
function firstContentLine(text: string, bodyStart: number, bodyEnd: number): number | null {
  let position = bodyStart
  while (position < bodyEnd) {
    const newline = text.indexOf('\n', position)
    const lineEnd = newline < 0 || newline > bodyEnd ? bodyEnd : newline
    if (lineEnd > position) return position
    position = lineEnd + 1
  }
  return null
}

/**
 * `text` with every heredoc body's first line made lexable.
 *
 * tree-sitter-bash decides where a heredoc body starts from the character
 * that follows the operator line, and gets it wrong for two shapes bash
 * reads fine: leading whitespace is skipped, and a line opening with a
 * backslash is lexed as more words of the operator line, so the line is
 * lost from the body and, worse, lands in whatever construct was open
 * (`tr a-z A-Z \first`), or breaks the parse outright once it holds an
 * apostrophe or a `;`. Replacing that one character (and the one a
 * backslash escapes, so `\$v` cannot surface as an expansion) with a
 * plain letter makes the scanner start the body exactly where bash does,
 * without moving a single offset; the caller then reads the body back
 * out of the untouched source. Returns null when every body already
 * lexes as bash reads it.
 */
export function protectedSource(text: string, root: Node): string | null {
  let out = text
  const bodies: [number, number][] = []
  for (const start of heredocStarts(root)) {
    if (bodies.some(([begin, end]) => begin <= start.startIndex && start.startIndex < end)) continue
    const delimiter = cleanDelimiter(start.text)
    if (delimiter === '') continue
    const previous = start.previousSibling
    const allowsIndent = previous !== null && previous.type === DASH_ARROW
    const span = heredocBodyRange(text, start.endIndex, delimiter, allowsIndent)
    if (span === null) continue
    bodies.push(span)
    const line = firstContentLine(text, span[0], span[1])
    if (line === null) continue
    const first = text[line] ?? ''
    if (!LINE_BLANKS.has(first) && first !== '\\') continue
    const filler = delimiter.startsWith(FILLER) ? ALTERNATE_FILLER : FILLER
    let masked = 1
    if (first === '\\' && line + 1 < span[1] && ESCAPE_PARTNERS.has(text[line + 1] ?? '')) {
      masked = 2
    }
    out = out.slice(0, line) + filler.repeat(masked) + out.slice(line + masked)
  }
  return out === text ? null : out
}

/** Whether two trees agree on every node's type and span. */
export function sameShape(left: Node, right: Node): boolean {
  const stack: [Node, Node][] = [[left, right]]
  for (;;) {
    const pair = stack.pop()
    if (pair === undefined) return true
    const [a, b] = pair
    if (
      a.type !== b.type ||
      a.startIndex !== b.startIndex ||
      a.endIndex !== b.endIndex ||
      a.childCount !== b.childCount
    ) {
      return false
    }
    const bChildren = b.children
    a.children.forEach((child, i) => {
      const other = bChildren[i]
      if (other !== undefined) stack.push([child, other])
    })
  }
}
