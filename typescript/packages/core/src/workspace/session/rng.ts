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

import {
  RANDOM,
  RANDOM_A,
  RANDOM_M,
  RANDOM_MAX,
  RANDOM_MODULUS,
  RANDOM_Q,
  RANDOM_R,
  RANDOM_UNSET,
  RANDOM_ZERO_SEED,
} from '../../shell/constants.ts'
import { evaluateArith } from '../../shell/arith.ts'
import { makeVar, withValue } from '../../shell/variable.ts'
import type { Session } from './session.ts'
import { sessionElements, visibleEnv } from './state.ts'

/** Evaluate a host-supplied seed; invalid arithmetic propagates. */
export function seedFrom(word: string, session: Session): number {
  const value = evaluateArith(word, visibleEnv(session), 0, sessionElements(session)).value
  const modulus = BigInt(RANDOM_MODULUS)
  return Number(((value % modulus) + modulus) % modulus)
}

/** A first seed for a session that was never assigned one: the clock,
 * stirred with the session id so two sessions born in one tick differ. */
function initialSeed(sessionId: string): number {
  let hash = 0
  for (const ch of sessionId) hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0
  return ((Date.now() % RANDOM_MODULUS) ^ hash) >>> 0
}

/** One step of bash's generator (`intrand32`): Park-Miller through
 * Schrage's method, a zero state stepping from the fixed seed. */
export function stepState(state: number): number {
  const ret = state === 0 ? RANDOM_ZERO_SEED : state
  const high = Math.floor(ret / RANDOM_Q)
  const low = ret - RANDOM_Q * high
  const step = RANDOM_A * low - RANDOM_R * high
  return step < 0 ? step + RANDOM_M : step
}

/** The `$RANDOM` value a state renders as (`brand`): the two 16-bit
 * halves folded, keeping 15 bits. */
export function valueOf(state: number): number {
  return ((state >>> 16) ^ (state & 0xffff)) & RANDOM_MAX
}

/** Draw from the session generator, or null after RANDOM is unset.
 * Shell assignments validate and seed at the session door. A host-seeded
 * variable is consumed here on its first read. Reseeding resets repeat
 * suppression to zero independently of the stored word. */
export function nextRandom(session: Session, stored: string | undefined): number | null {
  if (
    session.randomSeed === RANDOM_UNSET ||
    (stored === undefined && session.randomSeed !== null)
  ) {
    return null
  }
  let state: number
  let last: number
  const seed =
    stored !== undefined && stored !== session.randomSeed ? seedFrom(stored, session) : null
  if (seed !== null) {
    state = seed
    last = 0
  } else if (session.randomState === null) {
    state = initialSeed(session.sessionId)
    last = 0
  } else {
    state = session.randomState
    last = session.randomLast
  }
  let value: number
  do {
    state = stepState(state)
    value = valueOf(state)
  } while (value === last)
  session.randomState = state
  session.randomLast = value
  const word = String(value)
  const existing = session.vars[RANDOM]
  session.vars[RANDOM] = existing !== undefined ? withValue(existing, word) : makeVar(word)
  session.randomSeed = word
  return value
}
