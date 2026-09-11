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

import { ESCAPE_LEAD, SAFE_SLASH, isBlank, pathSafeName } from '../../utils/sanitize.ts'

const ASCII_DIGITS = /^[0-9]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether the text is a plain ASCII integer.
 *
 * Python's `int()` also accepts unicode digits and TS `parseInt` accepts a
 * digit-prefixed tail, so this is the one spelling both languages can agree
 * on for numeric path segments.
 */
export function asciiDigits(text: string): boolean {
  return ASCII_DIGITS.test(text)
}

/**
 * Whether the text is shaped like a YYYY-MM-DD date.
 *
 * Shape only, not a calendar check: the dated-message backends mint their
 * date directories from real timestamps, so a shaped-but-absent date
 * resolves through the listing like any other name. A backend that must
 * refuse impossible dates (gcal, whose day dirs exist by construction)
 * validates with its own calendar-aware check instead.
 */
export function isoDateShaped(text: string): boolean {
  return ISO_DATE.test(text)
}

/**
 * Render a free-form value as one segment `pathSafeDecode` inverts.
 *
 * `/` renders as `∕` the way `pathSafeName` renders it, and a value already
 * holding `∕` or `⁄` has that character prefixed with `⁄`. A blank value
 * (`isBlank`, the one definition of white space both runtimes read) takes
 * the lead too, so it renders as the lead plus its own characters (the empty
 * value is the lone lead) rather than as `pathSafeName`'s `unknown`;
 * `pathSafeName` itself leads a dot-led name, which the decode's escape rule
 * already inverts. The decode reads the segment back one token at a time, so
 * no two values render as one segment. Without the escape `a/b` and `a∕b`
 * would list as the same directory, and descending into it would filter for
 * only one.
 */
function pathSafeEncode(value: string): string {
  const escaped = value
    .replaceAll(ESCAPE_LEAD, ESCAPE_LEAD + ESCAPE_LEAD)
    .replaceAll(SAFE_SLASH, ESCAPE_LEAD + SAFE_SLASH)
  return pathSafeName(isBlank(escaped) ? ESCAPE_LEAD + escaped : escaped)
}

/**
 * Undo `pathSafeEncode`: `∕` reads as `/` and `⁄` as an escape for the
 * character after it; a lead with nothing after it escapes nothing, which is
 * how the empty value's lone lead reads back as empty and how a glob head cut
 * inside an escape pair loses only the dangling lead.
 */
function pathSafeDecode(name: string): string {
  let value = ''
  let escaped = false
  for (const char of name) {
    if (escaped) {
      value += char
      escaped = false
    } else if (char === ESCAPE_LEAD) {
      escaped = true
    } else if (char === SAFE_SLASH) {
      value += '/'
    } else {
      value += char
    }
  }
  return value
}

/**
 * How one dynamic path segment encodes its value.
 *
 * `suffix` is the extension the segment carries ('.json'); empty for bare
 * names. `validate` is an extra shape check on the decoded payload; a
 * failing payload means the segment does not match the scope at all.
 * `pathSafe` marks a free-form value rendered path-safe and reversibly:
 * `/` becomes `∕` (U+2215), a value already holding `∕` or `⁄` (U+2044) has
 * that character prefixed with `⁄`, and a blank or dot-led value is prefixed
 * with `⁄` as well, so every value has a segment that lists, opens and
 * `decode`s back to exactly what `encode` rendered. The group
 * levels of the table-shaped backends (qdrant, lancedb) are this shape: a
 * segment there becomes an equality filter, so it has to name exactly one
 * value.
 */
export class Codec {
  readonly suffix: string
  readonly validate: ((text: string) => boolean) | null
  readonly pathSafe: boolean

  constructor(
    init: { suffix?: string; validate?: (text: string) => boolean; pathSafe?: boolean } = {},
  ) {
    this.suffix = init.suffix ?? ''
    this.validate = init.validate ?? null
    this.pathSafe = init.pathSafe ?? false
  }

  /** Decode a path segment, null when it does not fit. */
  decode(text: string): string | null {
    let value = text
    if (this.suffix !== '') {
      if (!value.endsWith(this.suffix)) return null
      value = value.slice(0, -this.suffix.length)
    }
    if (value === '') return null
    if (this.pathSafe) value = pathSafeDecode(value)
    if (this.validate !== null && !this.validate(value)) return null
    return value
  }

  /** Render a value back into a path segment. */
  encode(value: string): string {
    const rendered = this.pathSafe ? pathSafeEncode(value) : value
    return `${rendered}${this.suffix}`
  }

  /**
   * The value prefix a rendered-name prefix stands for.
   *
   * What a backend pushes into its query when a glob's literal head narrows
   * a listing: every value whose rendering starts with `prefix` starts with
   * this, so the pushdown loses nothing, and the caller keeps only the
   * rendered names that really start with `prefix`. A head cut inside an
   * escape pair ends on a lead that could open either escaped character; the
   * decode drops it.
   */
  prefixValue(prefix: string): string {
    if (!this.pathSafe) return prefix
    return pathSafeDecode(prefix)
  }
}

export const RAW = new Codec()
export const JSON_NAME = new Codec({ suffix: '.json' })
export const JSONL_NAME = new Codec({ suffix: '.jsonl' })
export const INT_JSON = new Codec({ suffix: '.json', validate: asciiDigits })
export const DATE = new Codec({ validate: isoDateShaped })
export const PATH_SAFE = new Codec({ pathSafe: true })
