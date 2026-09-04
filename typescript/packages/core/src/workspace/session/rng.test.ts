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

function stored(s: Session): string | undefined {
  const v = s.vars[RANDOM]?.value
  return typeof v === 'string' ? v : undefined
}

describe('RANDOM generator', () => {
  it('reads the seed word as an integer', () => {
    expect(seedFrom('42')).toBe(42)
    expect(seedFrom('-1')).toBe(2 ** 32 - 1)
    expect(seedFrom('abc')).toBe(0)
  })

  it('is deterministic per seed and pins the python sequence', () => {
    const s = new Session({ sessionId: 'a' })
    const seq: (number | null)[] = []
    for (let i = 0; i < 5; i++) seq.push(nextRandom(s, i === 0 ? '42' : stored(s)))
    expect(seq).toEqual([19081, 17033, 15269, 25461, 13856])
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
    expect(nextRandom(s, stored(s))).toBe(15269)
    expect(parent).toEqual([19081, 17033])
    expect(child).not.toBe(15269)
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
        expect(io.stdoutText).toBe(drawFirst ? '17033\n' : '19081\n')
        expect(io.stderrText).toBe('')
      } finally {
        await ws.close()
      }
    })
  }
})
