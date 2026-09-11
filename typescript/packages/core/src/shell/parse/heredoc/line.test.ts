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

import { describe, expect, it } from 'vitest'
import { operatorLineEnd, quoteEnd } from './line.ts'

function end(command: string, word = 'EOF'): number | null {
  return operatorLineEnd(command, command.indexOf(word) + word.length)
}

describe('operatorLineEnd', () => {
  it('ends at the first newline', () => {
    expect(end('cat <<EOF\nbody\nEOF\n')).toBe('cat <<EOF'.length)
  })

  it('runs past a pipeline', () => {
    const cmd = 'cat <<EOF | tr a-z A-Z\nbody\nEOF\n'
    expect(end(cmd)).toBe(cmd.indexOf('\n'))
  })

  it('is not extended by a trailing pipe', () => {
    // Bash gathers the body at this newline and reads the rest of the
    // pipeline after the terminator.
    const cmd = 'cat <<EOF |\nbody\nEOF\ntr a-z A-Z\n'
    expect(end(cmd)).toBe(cmd.indexOf('\n'))
  })

  it('continues across a backslash newline', () => {
    const cmd = 'cat <<EOF \\\n| tr a-z A-Z\nbody\nEOF\n'
    expect(end(cmd)).toBe(cmd.indexOf('A-Z\n') + 3)
  })

  it('lets a comment after a blank hide its quote', () => {
    const cmd = "cat <<EOF # don't\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf("'t\n") + 2)
  })

  it.each([';', '|', '&&', '&', '(', ')', '<', '>'])(
    'lets a comment after %j hide its quote',
    (separator) => {
      const cmd = `cat <<EOF${separator}# don't\nbody\nEOF\n`
      expect(end(cmd)).toBe(cmd.indexOf("'t\n") + 2)
    },
  )

  it('does not read a hash inside a word as a comment', () => {
    const cmd = "cat <<EOF a#b'\nc'\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf("c'\n") + 2)
  })

  it('does not read a hash after a dollar as a comment', () => {
    const cmd = "cat <<EOF $#'\nc'\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf("c'\n") + 2)
  })

  it('runs a comment inside a substitution to its own newline', () => {
    const cmd = "cat <<EOF $(# don't\necho x)\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf('x)\n') + 2)
  })

  it('lets an ANSI-C quote escape its apostrophe', () => {
    const cmd = "cat <<EOF | grep $'it\\'s'\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf("s'\n") + 2)
  })

  it('does not end the line at a quoted newline', () => {
    const cmd = "cat <<EOF | tr 'a\nb' x\nbody\nEOF\n"
    expect(end(cmd)).toBe(cmd.indexOf(' x\n') + 2)
  })

  it('does not end the line inside a substitution', () => {
    const cmd = 'cat <<EOF | $(echo\ncat)\nbody\nEOF\n'
    expect(end(cmd)).toBe(cmd.indexOf('cat)\n') + 4)
  })

  it('never ends after an unterminated quote', () => {
    expect(end("cat <<EOF | tr 'a\nbody\nEOF\n")).toBeNull()
  })

  it('never ends without a newline', () => {
    expect(end('cat <<EOF')).toBeNull()
  })
})

describe('quoteEnd', () => {
  it('skips an escaped double quote', () => {
    expect(quoteEnd('"a\\"b" c', 0)).toBe(6)
  })

  it('takes a backslash literally in single quotes', () => {
    expect(quoteEnd("'a\\' b", 0)).toBe(4)
  })

  it('honors ANSI-C escapes', () => {
    expect(quoteEnd("$'a\\'b' c", 1)).toBe(7)
  })

  it('is null when unterminated', () => {
    expect(quoteEnd('"abc', 0)).toBeNull()
  })
})
