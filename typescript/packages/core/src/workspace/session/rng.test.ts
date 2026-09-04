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
import { RANDOM, RANDOM_MAX } from '../../shell/constants.ts'
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

  it('unset after a read strips the meaning', () => {
    const s = new Session({ sessionId: 's' })
    expect(nextRandom(s, undefined)).not.toBeNull()
    expect(nextRandom(s, undefined)).toBeNull()
  })
})
