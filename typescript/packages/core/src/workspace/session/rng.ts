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
import { makeVar, withValue } from '../../shell/variable.ts'
import type { Session } from './session.ts'

/** The generator seed an assignment `RANDOM=word` sets: bash reads the
 * word as an integer and a word that is not one as 0. */
export function seedFrom(word: string): number {
  const body = word.startsWith('-') || word.startsWith('+') ? word.slice(1) : word
  if (!/^[0-9]+$/.test(body)) return 0
  const modulus = BigInt(RANDOM_MODULUS)
  return Number(((BigInt(word) % modulus) + modulus) % modulus)
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

/** The value the previous draw returned, read off the word it wrote
 * back; 0 after a reseed, which is what `sbrand` resets it to. */
function lastValue(seed: string | null): number {
  return seed !== null && /^[0-9]+$/.test(seed) ? Number(seed) : 0
}

/**
 * Step `$RANDOM` and return its value, or null once it is unset.
 *
 * The variable store is the seed door and the record, as in bash: an
 * assignment `RANDOM=42` reseeds because the stored word differs from the
 * value the last read wrote back, and every read writes its value back so
 * `declare -p RANDOM` shows it and a repeated `RANDOM=42` reseeds again.
 * `unset RANDOM` strips the special meaning in bash, so the name reads as
 * an ordinary unset variable from then on: `unsetVar` marks the session
 * (RANDOM_UNSET) and a store that no longer holds the name after a read
 * says the same. The write-back is the shell's own bookkeeping on a name
 * it defines, not a user assignment, so it does not pass the session
 * plane's door.
 *
 * A draw never returns the value before it (bash's `get_random_number`
 * redraws on a repeat), and a reseed or a fresh generator starts that
 * comparison from 0, as `sbrand` does.
 */
export function nextRandom(session: Session, stored: string | undefined): number | null {
  if (
    session.randomSeed === RANDOM_UNSET ||
    (stored === undefined && session.randomSeed !== null)
  ) {
    return null
  }
  let state: number
  let last: number
  if (stored !== undefined && stored !== session.randomSeed) {
    state = seedFrom(stored)
    last = 0
  } else if (session.randomState === null) {
    state = initialSeed(session.sessionId)
    last = 0
  } else {
    state = session.randomState
    last = lastValue(session.randomSeed)
  }
  let value: number
  do {
    state = stepState(state)
    value = valueOf(state)
  } while (value === last)
  session.randomState = state
  const word = String(value)
  const existing = session.vars[RANDOM]
  session.vars[RANDOM] = existing !== undefined ? withValue(existing, word) : makeVar(word)
  session.randomSeed = word
  return value
}
