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
import { makeIntegrationWS } from '../fixtures/integration_fixture.ts'
import { RANDOM, RANDOM_MAX } from '../../shell/constants.ts'
import { makeVar } from '../../shell/variable.ts'
import { nextRandom, seedFrom } from './rng.ts'
import { Session } from './session.ts'
import { ArithError } from '../../shell/errors.ts'
import { sessionView } from './state.ts'

function stored(s: Session): string | undefined {
  const v = s.vars[RANDOM]?.value
  return typeof v === 'string' ? v : undefined
}

describe('RANDOM generator', () => {
  it('evaluates the seed word as arithmetic', () => {
    const s = new Session({ sessionId: 's' })
    s.vars.x = makeVar('42')
    expect(seedFrom('42', s)).toBe(42)
    expect(seedFrom('-1', s)).toBe(2 ** 32 - 1)
    expect(seedFrom('abc', s)).toBe(0)
    expect(seedFrom('', s)).toBe(0)
    expect(seedFrom('1+2', s)).toBe(3)
    expect(seedFrom('0x10', s)).toBe(16)
    expect(seedFrom('010', s)).toBe(8)
    expect(seedFrom('x', s)).toBe(42)
    expect(seedFrom('x*2', s)).toBe(84)
    expect(() => seedFrom('1.5', s)).toThrow(ArithError)
    expect(() => seedFrom('1+', s)).toThrow(ArithError)
    expect(() => seedFrom('08', s)).toThrow(ArithError)
  })

  it('leaves the generator alone on a word that does not evaluate', async () => {
    // bash 5.2.37: `RANDOM=0; echo $RANDOM; RANDOM=1.5; echo $RANDOM`
    // prints the error for 1.5 and then 24386, the second draw of seed 0.
    const s = new Session({ sessionId: 's' })
    expect(nextRandom(s, '0')).toBe(20814)
    await sessionView(s, null).set(RANDOM, '1.5')
    expect(s.diagnostics).toEqual(['1.5: syntax error: invalid character "."'])
    expect(nextRandom(s, stored(s))).toBe(24386)
    expect(nextRandom(s, stored(s))).toBe(149)
  })

  it.each([
    ['1', [16807, 10791, 19566]],
    ['0', [20814, 24386, 149]],
    ['-1', [16807, 10791, 19566]],
    ['4294967338', [17772, 26794, 1435]],
    ['32768', [8403, 3502, 14043]],
    ['1+2', [17653, 593, 9386]],
    ['0x10', [6772, 8817, 18150]],
    ['abc', [20814, 24386, 149]],
  ] as const)('seed %s draws bash 5.2 sequence', (seed, expected) => {
    // Pinned against bash 5.2.37 on debian:stable-slim. -1 truncates to
    // 32 bits, 4294967338 is 42 past 2**32, seed 32768 renders 0 on its
    // first step, which the no-repeat rule redraws, and the last three
    // are arithmetic words: 3, 16, and an unset name.
    const s = new Session({ sessionId: 's' })
    const drawn: (number | null)[] = []
    for (let i = 0; i < 3; i++) drawn.push(nextRandom(s, i === 0 ? seed : stored(s)))
    expect(drawn).toEqual(expected)
  })

  it('is deterministic per seed and pins the python sequence', () => {
    const s = new Session({ sessionId: 'a' })
    const seq: (number | null)[] = []
    for (let i = 0; i < 5; i++) seq.push(nextRandom(s, i === 0 ? '42' : stored(s)))
    expect(seq).toEqual([17772, 26794, 1435, 24388, 11074])
    for (const v of seq) expect(v !== null && v >= 0 && v <= RANDOM_MAX).toBe(true)
  })

  it('reseeds only on a new stored word and writes its value back', () => {
    const s = new Session({ sessionId: 's' })
    const first = nextRandom(s, '7')
    expect(stored(s)).toBe(String(first))
    const again = new Session({ sessionId: 't' })
    expect(nextRandom(again, '7')).toBe(first)
  })

  it('reseeds in a child shell and hands the parent its state back', () => {
    const s = new Session({ sessionId: 's' })
    const parent = [nextRandom(s, '42'), nextRandom(s, stored(s))]
    const saved = s.snapshot()
    const child = nextRandom(s, stored(s))
    expect(s.randomState).not.toBeNull()
    s.restore(saved)
    expect(nextRandom(s, stored(s))).toBe(1435)
    expect(parent).toEqual([17772, 26794])
    expect(child).not.toBe(1435)
  })

  it('does not replay a pending seed in the child, and keeps unset unset', () => {
    const s = new Session({ sessionId: 's' })
    s.vars[RANDOM] = makeVar('42')
    s.snapshot()
    expect(s.randomSeed).toBe('42')
    expect(s.randomState).toBeNull()
    const unset = new Session({ sessionId: 'u' })
    nextRandom(unset, undefined)
    expect(nextRandom(unset, undefined)).toBeNull()
    unset.snapshot()
    expect(nextRandom(unset, undefined)).toBeNull()
  })

  it('unset after a read strips the meaning', () => {
    const s = new Session({ sessionId: 's' })
    expect(nextRandom(s, undefined)).not.toBeNull()
    expect(nextRandom(s, undefined)).toBeNull()
  })
})

describe('child RANDOM isolation', () => {
  for (const drawFirst of [false, true]) {
    it.each([
      'echo $RANDOM | cat >/dev/null',
      'echo x | { read x; : $RANDOM; }',
      'x=$(echo $RANDOM)',
      'x=`echo $RANDOM`',
      'x=$(echo $RANDOM # trailing comment\n)',
      'x=$(echo $(echo $RANDOM))',
      'x=$(: $RANDOM; exit 7)',
      'echo x | { : $RANDOM; exit 7; }',
    ])(`preserves parent state after %s (draw first: ${String(drawFirst)})`, async (child) => {
      const { ws } = await makeIntegrationWS()
      try {
        const prefix = 'RANDOM=42; ' + (drawFirst ? ': $RANDOM; ' : '')
        const io = await ws.execute(prefix + child + '; echo $RANDOM')
        expect(io.exitCode).toBe(0)
        expect(io.stdoutText).toBe(drawFirst ? '26794\n' : '17772\n')
        expect(io.stderrText).toBe('')
      } finally {
        await ws.close()
      }
    })
  }
})

it.each([
  ['RANDOM=1.5; echo ok:$?', 'ok:0\n', 'bash: 1.5:'],
  ['RANDOM=0; : $RANDOM; RANDOM=1.5; echo $RANDOM', '24386\n', 'bash: 1.5:'],
  ['export RANDOM=1.5; echo ok:$?', 'ok:0\n', 'bash: export: 1.5:'],
  ['declare RANDOM=1.5; echo ok:$?', 'ok:0\n', 'bash: declare: 1.5:'],
  ['RANDOM=1.5 x=kept; echo $x', 'kept\n', 'bash: 1.5:'],
  ['{ RANDOM=1.5; echo ok; } 2>/dev/null', 'ok\n', ''],
  ['RANDOM=42; x=$(RANDOM=1.5; echo ok); echo $x $RANDOM', 'ok 17772\n', 'bash: 1.5:'],
  ['unset RANDOM; RANDOM=1.5; echo $RANDOM', '1.5\n', ''],
  ['x=42; RANDOM=x; x=0; echo $RANDOM', '17772\n', ''],
  ['RANDOM=42; RANDOM=$RANDOM; echo $RANDOM', '9401\n', ''],
])('reports seed assignment diagnostics: %s', async (command, stdout, prefix) => {
  const { ws } = await makeIntegrationWS()
  try {
    const io = await ws.execute(command)
    expect(io.exitCode).toBe(0)
    expect(io.stdoutText).toBe(stdout)
    if (prefix) {
      expect(io.stderrText.startsWith(prefix)).toBe(true)
      expect(io.stderrText).toContain('syntax error')
      expect(io.stderrText.split('\n')).toHaveLength(2)
    } else expect(io.stderrText).toBe('')
  } finally {
    await ws.close()
  }
})

it.each([
  ['RANDOM=42; echo $((RANDOM)) $((RANDOM)) $RANDOM', '17772 26794 1435\n'],
  ['RANDOM=42; echo $((RANDOM+RANDOM)) $RANDOM', '44566 1435\n'],
  [
    'RANDOM=42; echo $((0 && RANDOM)) $((1 || RANDOM)) $((1 ? 5 : RANDOM)) $RANDOM',
    '0 1 5 17772\n',
  ],
  ['x=RANDOM; RANDOM=42; echo $((x)) $((x)) $RANDOM', '17772 26794 1435\n'],
  ["RANDOM=42; (( x=RANDOM )); let 'y=RANDOM'; echo $x $y $RANDOM", '17772 26794 1435\n'],
  [
    'RANDOM=42; for ((i=0; i<2; i++)); do echo $((RANDOM)); done; echo $RANDOM',
    '17772\n26794\n1435\n',
  ],
  ['RANDOM=42; [[ RANDOM -eq 17772 ]]; echo $? $RANDOM', '0 26794\n'],
  ['unset RANDOM; RANDOM=42; echo $((RANDOM)) $((RANDOM))', '42 42\n'],
])('draws RANDOM lazily in arithmetic: %s', async (command, stdout) => {
  const { ws } = await makeIntegrationWS()
  try {
    const io = await ws.execute(command)
    expect(io.exitCode).toBe(0)
    expect(io.stdoutText).toBe(stdout)
    expect(io.stderrText).toBe('')
  } finally {
    await ws.close()
  }
})
