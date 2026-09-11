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

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, type Node, Parser } from 'web-tree-sitter'
import { cleanDelimiter, heredocBodyRange, protectedSource, sameShape } from './heredoc.ts'

const require = createRequire(import.meta.url)
const engineWasm = readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'))
const grammarWasm = readFileSync(require.resolve('tree-sitter-bash/tree-sitter-bash.wasm'))

let parser: Parser

beforeAll(async () => {
  await Parser.init({ wasmBinary: engineWasm })
  const language = await Language.load(new Uint8Array(grammarWasm))
  parser = new Parser()
  parser.setLanguage(language)
})

function root(command: string): Node {
  const tree = parser.parse(command)
  if (tree === null) throw new Error('parse returned null')
  return tree.rootNode
}

// The (offset, replacement) pairs by which `after` differs from `before`.
function diff(before: string, after: string): [number, string][] {
  const out: [number, string][] = []
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) out.push([i, after[i] ?? ''])
  }
  return out
}

function range(command: string, delimiter = 'EOF', dash = false): [number, number] | null {
  let start = command.indexOf('<<') + (dash ? 3 : 2)
  const rest = command.slice(start)
  start += (rest.split('\n', 1)[0] ?? '').split(' ', 1)[0]?.length ?? 0
  return heredocBodyRange(command, start, delimiter, dash)
}

describe('cleanDelimiter', () => {
  it.each([
    ['EOF', 'EOF'],
    ["'EOF'", 'EOF'],
    ['"EOF"', 'EOF'],
    ["EN'D'", 'END'],
    ['\\EOF', 'EOF'],
    ['E\\OF', 'EOF'],
    ["'EO F'", 'EO F'],
  ])('reads %j as %j', (token, expected) => {
    expect(cleanDelimiter(token)).toBe(expected)
  })
})

describe('heredocBodyRange', () => {
  it('spans the lines between the operator line and the terminator', () => {
    expect(range('cat <<EOF\nbody\nEOF\n')).toEqual([10, 15])
  })

  it('ends at a terminator without a trailing newline', () => {
    expect(range('cat <<EOF\nbody\nEOF')).toEqual([10, 15])
  })

  it('starts after a pipeline on the operator line', () => {
    const cmd = 'cat <<EOF | tr a-z A-Z\nbody\nEOF\n'
    expect(range(cmd)).toEqual([cmd.indexOf('body'), cmd.indexOf('EOF\n', 10)])
  })

  it('honors a line continuation', () => {
    const cmd = 'cat <<EOF \\\n| tr a-z A-Z\nbody\nEOF\n'
    expect(range(cmd)).toEqual([cmd.indexOf('body'), cmd.lastIndexOf('EOF')])
  })

  it('lets a comment hold a quote', () => {
    const cmd = "cat <<EOF # don't\nbody\nEOF\n"
    expect(range(cmd)).toEqual([cmd.indexOf('body'), cmd.lastIndexOf('EOF')])
  })

  it('does not end the line at a quoted newline', () => {
    const cmd = "cat <<EOF | tr 'a\nb' x\nbody\nEOF\n"
    expect(range(cmd)).toEqual([cmd.indexOf('body'), cmd.lastIndexOf('EOF')])
  })

  it('does not end the line inside a substitution', () => {
    const cmd = 'cat <<EOF | $(echo\ncat)\nbody\nEOF\n'
    expect(range(cmd)).toEqual([cmd.indexOf('body'), cmd.lastIndexOf('EOF')])
  })

  it('allows a tab-indented terminator under <<-', () => {
    const cmd = 'cat <<-EOF\n\tbody\n\tEOF\n'
    expect(range(cmd, 'EOF', true)).toEqual([cmd.indexOf('\tbody'), cmd.indexOf('\tEOF')])
  })

  it('ignores a space-indented terminator under <<-', () => {
    expect(range('cat <<-EOF\n  body\n  EOF\n', 'EOF', true)).toBeNull()
  })

  it('is null for an unterminated body', () => {
    expect(range('cat <<EOF\nbody\nmore\n')).toBeNull()
  })

  it('is null without a body line', () => {
    expect(range('cat <<EOF')).toBeNull()
  })

  it('matches the unquoted delimiter', () => {
    const cmd = "cat <<EN'D'\nbody\nEND\n"
    expect(range(cmd, 'END')).toEqual([cmd.indexOf('body'), cmd.lastIndexOf('END')])
  })
})

describe('protectedSource', () => {
  it('is null when the body lexes already', () => {
    const cmd = 'cat <<EOF\nfirst\nsecond\nEOF\n'
    expect(protectedSource(cmd, root(cmd))).toBeNull()
  })

  it('masks a leading backslash', () => {
    const cmd = "cat <<'EOF'\n\\first\nsecond\nEOF\n"
    const out = protectedSource(cmd, root(cmd))
    expect(out).not.toBeNull()
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('\\first'), 'x']])
  })

  it('masks the escaped partner too', () => {
    const cmd = 'cat <<EOF\n\\$v\nsecond\nEOF\n'
    const out = protectedSource(cmd, root(cmd))
    const at = cmd.indexOf('\\$v')
    expect(diff(cmd, out ?? '')).toEqual([
      [at, 'x'],
      [at + 1, 'x'],
    ])
  })

  it('masks leading indentation', () => {
    const cmd = "cat <<'EOF'\n  first\nsecond\nEOF\n"
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('  first'), 'x']])
  })

  it('skips blank lines before the first content line', () => {
    const cmd = "cat <<'EOF'\n\n\\first\nsecond\nEOF\n"
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('\\first'), 'x']])
  })

  it("avoids the delimiter's first letter", () => {
    const cmd = 'cat <<xfirst\n\\first\nsecond\nxfirst\n'
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('\\first'), 'y']])
  })

  it('handles every heredoc of a line list', () => {
    const cmd = 'cat <<A\n\\one\nA\ncat <<B\n\\two\nB\n'
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([
      [cmd.indexOf('\\one'), 'x'],
      [cmd.indexOf('\\two'), 'x'],
    ])
  })

  it('ignores an operator inside a body', () => {
    // The swallowed first line spells `<<X`; body text is not syntax.
    const cmd = 'cat <<EOF\n\\a <<X\nsecond\nEOF\n'
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('\\a'), 'x']])
  })

  it('masks the leading tab under <<-', () => {
    const cmd = "cat <<-'EOF'\n\t\\first\n\tsecond\n\tEOF\n"
    const out = protectedSource(cmd, root(cmd))
    expect(diff(cmd, out ?? '')).toEqual([[cmd.indexOf('\t\\first'), 'x']])
  })

  it('leaves an unterminated heredoc alone', () => {
    const cmd = 'cat <<EOF\n\\first\nsecond\n'
    expect(protectedSource(cmd, root(cmd))).toBeNull()
  })
})

describe('sameShape', () => {
  it('is true for equal parses', () => {
    expect(sameShape(root('echo a | grep b'), root('echo a | grep b'))).toBe(true)
  })

  it('is false for a different tree', () => {
    expect(sameShape(root('echo a | grep b'), root('echo a; grep b'))).toBe(false)
  })

  it('is false when a span moves', () => {
    expect(sameShape(root('echo ab'), root('echo abc'))).toBe(false)
  })
})
