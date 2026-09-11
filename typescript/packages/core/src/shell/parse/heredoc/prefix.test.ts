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
import { Language, Parser } from 'web-tree-sitter'
import type { TSNodeLike } from '../../types.ts'
import { createShellParser, type ShellParser } from '../parse.ts'
import { bodyPrefix } from './prefix.ts'

const require = createRequire(import.meta.url)
const engineWasm = readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'))
const grammarWasm = readFileSync(require.resolve('tree-sitter-bash/tree-sitter-bash.wasm'))

const HEREDOC_REDIRECT = 'heredoc_redirect'

let shielding: ShellParser
let plain: Parser

beforeAll(async () => {
  shielding = await createShellParser({ engineWasm, grammarWasm })
  await Parser.init({ wasmBinary: engineWasm })
  const language = await Language.load(new Uint8Array(grammarWasm))
  plain = new Parser()
  plain.setLanguage(language)
})

function redirect(root: TSNodeLike): TSNodeLike {
  const stack: TSNodeLike[] = [root]
  for (;;) {
    const node = stack.pop()
    if (node === undefined) throw new Error('no heredoc_redirect in the tree')
    if (node.type === HEREDOC_REDIRECT) return node
    stack.push(...node.children)
  }
}

function prefix(command: string): string {
  return bodyPrefix(redirect(shielding.parse(command) as TSNodeLike))
}

describe('bodyPrefix', () => {
  it('is empty when the node starts the body', () => {
    expect(prefix('cat <<EOF\nfoo\nEOF\n')).toBe('')
  })

  it('is the leading empty line', () => {
    expect(prefix('cat <<EOF\n\nfoo\nEOF\n')).toBe('\n')
  })

  it('is every leading empty line', () => {
    expect(prefix('cat <<EOF\n\n\nfoo\nEOF\n')).toBe('\n\n')
  })

  it('precedes a backslash line', () => {
    expect(prefix('cat <<EOF\n\n\\first\nEOF\n')).toBe('\n')
  })

  it('is the whole body when that is one empty line', () => {
    expect(prefix('cat <<EOF\n\nEOF\n')).toBe('\n')
  })

  it('follows a pipeline on the operator line', () => {
    expect(prefix('cat <<EOF | tr a-z A-Z\n\nfoo\nEOF\n')).toBe('\n')
  })

  it('follows a comment on the operator line', () => {
    expect(prefix("cat <<EOF # don't\n\nfoo\nEOF\n")).toBe('\n')
  })

  it('follows a file redirect', () => {
    expect(prefix('cat > /data/x <<EOF\n\nfoo\nEOF\n')).toBe('\n')
  })

  it('works under <<-', () => {
    expect(prefix('cat <<-EOF\n\n\tfoo\nEOF\n')).toBe('\n')
  })

  it('leaves a blank first line to the body', () => {
    expect(prefix('cat <<EOF\n  \nfoo\nEOF\n')).toBe('')
  })

  it('is the indentation an unshielded tree skipped', () => {
    const cmd = 'cat <<EOF\n  foo\nEOF\n'
    const tree = plain.parse(cmd)
    if (tree === null) throw new Error('parse returned null')
    expect(bodyPrefix(redirect(tree.rootNode as TSNodeLike))).toBe('  ')
  })
})
