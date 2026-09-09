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
import { Generations } from './generation.ts'

describe('Generations', () => {
  it('a removal of the key makes the stamp stale', () => {
    const g = new Generations()
    const stamp = g.enter('/a')
    g.bump('/a')
    expect(g.stale('/a', stamp)).toBe(true)
    g.leave('/a')
  })

  it('a removal of another key does not', () => {
    const g = new Generations()
    const stamp = g.enter('/a')
    g.bump('/b')
    expect(g.stale('/a', stamp)).toBe(false)
    g.leave('/a')
  })

  it('a store-wide invalidation reaches every writer', () => {
    const g = new Generations()
    const stamp = g.enter('/a')
    g.bumpAll()
    expect(g.stale('/a', stamp)).toBe(true)
    g.leave('/a')
  })

  it('a removal with no writer in flight leaves nothing behind', () => {
    const g = new Generations()
    g.bump('/a')
    const stamp = g.enter('/a')
    expect(g.stale('/a', stamp)).toBe(false)
    g.leave('/a')
  })

  it('the last writer out drops the key generation', () => {
    const g = new Generations()
    g.enter('/a')
    const second = g.enter('/a')
    g.bump('/a')
    g.leave('/a')
    expect(g.stale('/a', second)).toBe(true)
    g.leave('/a')
    const fresh = g.enter('/a')
    expect(g.stale('/a', fresh)).toBe(false)
    g.leave('/a')
  })
})
