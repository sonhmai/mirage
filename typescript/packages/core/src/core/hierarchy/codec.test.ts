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
import { DATE, INT_JSON, JSON_NAME, JSONL_NAME, PATH_SAFE, RAW, asciiDigits } from './codec.ts'

describe('hierarchy codec', () => {
  it('RAW takes any nonempty segment', () => {
    expect(RAW.decode('anything')).toBe('anything')
    expect(RAW.decode('')).toBeNull()
  })

  it('JSON_NAME strips the suffix and refuses bare ones', () => {
    expect(JSON_NAME.decode('trace1.json')).toBe('trace1')
    expect(JSON_NAME.decode('trace1.jsonl')).toBeNull()
    expect(JSON_NAME.decode('.json')).toBeNull()
    expect(JSON_NAME.decode('noext')).toBeNull()
    expect(JSON_NAME.encode('trace1')).toBe('trace1.json')
  })

  it('JSONL_NAME is the jsonl twin', () => {
    expect(JSONL_NAME.decode('run.jsonl')).toBe('run')
    expect(JSONL_NAME.decode('run.json')).toBeNull()
  })

  it('INT_JSON requires plain ascii digits', () => {
    expect(INT_JSON.decode('12.json')).toBe('12')
    expect(INT_JSON.decode('007.json')).toBe('007')
    // int() would accept these; parseInt would guess at the first; both
    // languages must refuse them identically.
    expect(INT_JSON.decode('12abc.json')).toBeNull()
    expect(INT_JSON.decode('1.5.json')).toBeNull()
    expect(INT_JSON.decode('١٢.json')).toBeNull()
  })

  it('asciiDigits guards the numeric shape', () => {
    expect(asciiDigits('42')).toBe(true)
    expect(asciiDigits('4x2')).toBe(false)
    expect(asciiDigits('')).toBe(false)
  })
})

describe('DATE', () => {
  it('is shape only, not a calendar check', () => {
    // The dated-message backends mint their date directories from real
    // timestamps, so a shaped-but-absent date resolves through the
    // listing like any other name.
    expect(DATE.decode('2024-01-15')).toBe('2024-01-15')
    expect(DATE.decode('2026-02-30')).toBe('2026-02-30')
    expect(DATE.decode('2024-1-15')).toBeNull()
    expect(DATE.decode('notadate')).toBeNull()
    expect(DATE.decode('2024-01-15x')).toBeNull()
  })
})

describe('PATH_SAFE', () => {
  it('gives every value its own segment and decodes it back', () => {
    // `/` renders as `∕`; a value already holding `∕` or `⁄` has that
    // character escaped, so `a/b` and `a∕b` cannot name one directory and
    // the decode recovers exactly the value that was rendered.
    expect(PATH_SAFE.encode('a/b')).toBe('a∕b')
    expect(PATH_SAFE.encode('a∕b')).toBe('a⁄∕b')
    expect(PATH_SAFE.encode('a⁄b')).toBe('a⁄⁄b')
    for (const raw of ['plain', 'a/b', 'a∕b', 'a⁄b', '/∕⁄/', '⁄∕']) {
      expect(PATH_SAFE.decode(PATH_SAFE.encode(raw))).toBe(raw)
    }
    expect(new Set(['a/b', 'a∕b', 'a⁄∕b'].map((raw) => PATH_SAFE.encode(raw))).size).toBe(3)
  })

  it('keeps blank and dot-led values addressable', () => {
    // A blank value would render as `unknown` and a dot-led one as a hidden
    // segment, and neither could then be listed and opened as the value it
    // stands for. Both carry the escape lead instead: an empty value is the
    // lone lead, and the decode reads a lead with nothing after it as
    // escaping nothing.
    expect(PATH_SAFE.encode('')).toBe('⁄')
    expect(PATH_SAFE.encode(' ')).toBe('⁄ ')
    expect(PATH_SAFE.encode('.env')).toBe('⁄.env')
    expect(PATH_SAFE.encode('..')).toBe('⁄..')
    expect(PATH_SAFE.encode('unknown')).toBe('unknown')
    const edges = ['', ' ', '  ', '.', '..', '.env', './x', '.⁄', '⁄.x', 'unknown']
    for (const raw of edges) {
      expect(PATH_SAFE.decode(PATH_SAFE.encode(raw))).toBe(raw)
      expect(PATH_SAFE.encode(raw).startsWith('.')).toBe(false)
    }
    expect(new Set(edges.map((raw) => PATH_SAFE.encode(raw))).size).toBe(edges.length)
    expect(PATH_SAFE.decode('⁄')).toBe('')
    expect(PATH_SAFE.decode('a⁄')).toBe('a')
    expect(PATH_SAFE.decode('')).toBeNull()
    expect(RAW.encode('a/b')).toBe('a/b')
  })

  it('reads blank as the shared White_Space set', () => {
    // `str.strip` and `trim` disagree at the edges (U+001C..U+001F, U+0085,
    // U+FEFF), so a value only one runtime called blank took the lead in one
    // tree and not the other. Blank is the White_Space property in both,
    // read from `utils/sanitize`.
    expect(PATH_SAFE.encode('\u0085')).toBe('⁄\u0085')
    expect(PATH_SAFE.encode('\u3000')).toBe('⁄\u3000')
    expect(PATH_SAFE.encode('\u001c')).toBe('\u001c')
    expect(PATH_SAFE.encode('\ufeff')).toBe('\ufeff')
    for (const raw of ['\u0085', '\u3000', '\u001c', '\ufeff']) {
      expect(PATH_SAFE.decode(PATH_SAFE.encode(raw))).toBe(raw)
    }
  })

  it('prefixValue is what a rendered prefix implies about the value', () => {
    // A backend that pushes a glob's literal head into a query needs the
    // VALUE prefix that rendered head stands for. A head cut inside an
    // escape pair drops the dangling lead, so the pushdown stays a sound
    // over-approximation the rendered-name filter then tightens.
    expect(PATH_SAFE.prefixValue('doc-03')).toBe('doc-03')
    expect(PATH_SAFE.prefixValue('a∕')).toBe('a/')
    expect(PATH_SAFE.prefixValue('a⁄∕')).toBe('a∕')
    expect(PATH_SAFE.prefixValue('a⁄')).toBe('a')
    expect(PATH_SAFE.prefixValue('a⁄⁄')).toBe('a⁄')
    expect(PATH_SAFE.prefixValue('')).toBe('')
    expect(PATH_SAFE.prefixValue('⁄')).toBe('')
    expect(PATH_SAFE.prefixValue('⁄.e')).toBe('.e')
    expect(RAW.prefixValue('a∕')).toBe('a∕')
  })
})
