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
  RANDOM_INCREMENT,
  RANDOM_MAX,
  RANDOM_MODULUS,
  RANDOM_MULTIPLIER,
  RANDOM_UNSET,
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
 */
export function nextRandom(session: Session, stored: string | undefined): number | null {
  if (
    session.randomSeed === RANDOM_UNSET ||
    (stored === undefined && session.randomSeed !== null)
  ) {
    return null
  }
  if (stored !== undefined && stored !== session.randomSeed) {
    session.randomState = seedFrom(stored)
  } else {
    session.randomState ??= initialSeed(session.sessionId)
  }
  const state = (Math.imul(session.randomState, RANDOM_MULTIPLIER) + RANDOM_INCREMENT) >>> 0
  session.randomState = state
  const value = (state >>> 16) & RANDOM_MAX
  const word = String(value)
  const existing = session.vars[RANDOM]
  session.vars[RANDOM] = existing !== undefined ? withValue(existing, word) : makeVar(word)
  session.randomSeed = word
  return value
}
