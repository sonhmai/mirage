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

import { valueText } from '../render/json.ts'
import { groupName } from './naming.ts'
import { fieldValue } from './payload.ts'

export type QdrantRow = Record<string, unknown>

export interface QdrantPoint {
  id: string | number
  payload?: Record<string, unknown> | null
  score?: number
}

export const SCROLL_BATCH = 256

/**
 * The non-string JSON scalar a rendered group segment also spells, or null.
 *
 * A group value renders through `valueText`, so a boolean or a number lists
 * as its compact JSON and the segment alone cannot say which type the
 * payload holds. Only a spelling `valueText` would produce counts: `007`,
 * `-0` and `1.50` are strings and nothing else.
 */
export function jsonScalar(text: string): boolean | number | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed === 'boolean') return parsed
  if (typeof parsed === 'number' && valueText(parsed) === text) return parsed
  return null
}

/**
 * What one rendered group segment matches in the payload: the string itself
 * always, and when the segment also spells a JSON scalar, that typed value
 * too, so descending into the `true` or `1.5` directory the listing
 * advertised finds the boolean or float points behind it. A number matches
 * as a closed range, which Qdrant applies to integer and float payloads
 * alike where `match` does not.
 */
export function condition(key: string, text: string): Record<string, unknown> {
  const asText = { key, match: { value: text } }
  const scalar = jsonScalar(text)
  if (scalar === null) return asText
  const typed =
    typeof scalar === 'boolean'
      ? { key, match: { value: scalar } }
      : { key, range: { gte: scalar, lte: scalar } }
  return { should: [asText, typed] }
}

export function buildFilter(filters: Record<string, string>): Record<string, unknown> | undefined {
  const keys = Object.keys(filters)
  if (keys.length === 0) return undefined
  return { must: keys.map((key) => condition(key, filters[key] ?? '')) }
}

export type PointTest = (point: QdrantPoint) => boolean

/** Keep points whose id starts with a literal name prefix. */
export function idPrefixTest(prefix: string): PointTest {
  return (point) => String(point.id).startsWith(prefix)
}

/** Keep points whose payload value starts with a literal prefix. */
export function valuePrefixTest(column: string, prefix: string, basename = false): PointTest {
  return (point) => {
    const value = fieldValue(point.payload ?? {}, column)
    if (value === null || value === undefined) return false
    return groupName(value, basename).startsWith(prefix)
  }
}

/** Keep the first point of every raw value that renders as one group name. */
export function exactNameTest(
  column: string,
  name: string,
  basename: boolean,
  seen: Set<string>,
): PointTest {
  return (point) => {
    const value = fieldValue(point.payload ?? {}, column)
    if (value === null || value === undefined) return false
    const raw = valueText(value)
    if (seen.has(raw) || groupName(raw, basename) !== name) return false
    seen.add(raw)
    return true
  }
}

export function pointToRow(point: QdrantPoint, idField: string): QdrantRow {
  const payload = point.payload ?? {}
  const row: QdrantRow = { ...payload }
  row[idField] = point.id
  return row
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function candidateIds(rowId: string): (string | number)[] {
  if (/^-?\d+$/.test(rowId)) return [Number.parseInt(rowId, 10)]
  if (UUID_RE.test(rowId)) return [rowId]
  return []
}
