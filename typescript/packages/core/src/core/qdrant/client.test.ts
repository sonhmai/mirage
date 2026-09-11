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

import {
  buildFilter,
  candidateIds,
  condition,
  jsonScalar,
  exactNameTest,
  pointToRow,
  valuePrefixTest,
} from './client.ts'

describe('qdrant client helpers', () => {
  it('matches a plain segment as the string alone', () => {
    expect(condition('k', 'cat')).toEqual({ key: 'k', match: { value: 'cat' } })
  })

  it('adds the typed scalar a segment also spells', () => {
    // The listing renders a boolean or a number as compact JSON, so the
    // segment matches the string and the typed payload both; a number is
    // a closed range so integer and float payloads alike answer.
    expect(condition('k', 'true')).toEqual({
      should: [
        { key: 'k', match: { value: 'true' } },
        { key: 'k', match: { value: true } },
      ],
    })
    expect(condition('k', '12')).toEqual({
      should: [
        { key: 'k', match: { value: '12' } },
        { key: 'k', range: { gte: 12, lte: 12 } },
      ],
    })
    expect(condition('k', '1.5')).toEqual({
      should: [
        { key: 'k', match: { value: '1.5' } },
        { key: 'k', range: { gte: 1.5, lte: 1.5 } },
      ],
    })
  })

  it('keeps a spelling no value renders as a string', () => {
    for (const text of ['007', '05', '-0', '1.50', '1e5', 'NaN', 'null']) {
      expect(jsonScalar(text)).toBeNull()
      expect(condition('k', text)).toEqual({ key: 'k', match: { value: text } })
    }
  })

  it('builds a must filter, undefined when empty', () => {
    expect(buildFilter({})).toBeUndefined()
    expect(buildFilter({ label: 'cat', n: '2' })).toEqual({
      must: [
        { key: 'label', match: { value: 'cat' } },
        {
          should: [
            { key: 'n', match: { value: '2' } },
            { key: 'n', range: { gte: 2, lte: 2 } },
          ],
        },
      ],
    })
  })

  it('maps a point to a row keyed by the point id', () => {
    const row = pointToRow({ id: 7, payload: { label: 'cat' } }, 'id')
    expect(row).toEqual({ label: 'cat', id: 7 })
  })

  it('matches a rendered basename rather than the source prefix', () => {
    const keep = valuePrefixTest('metadata.source', 'report-', true)
    expect(keep({ id: 1, payload: { metadata: { source: 's3://archive/report-late.pdf' } } })).toBe(
      true,
    )
    expect(keep({ id: 2, payload: { metadata: { source: 's3://archive/notes.pdf' } } })).toBe(false)
  })

  it('keeps one point per raw value that renders as the name', () => {
    const seen = new Set<string>()
    const keep = exactNameTest('metadata.source', 'report.pdf', true, seen)
    expect(keep({ id: 1, payload: { metadata: { source: 's3://one/report.pdf' } } })).toBe(true)
    expect(keep({ id: 2, payload: { metadata: { source: 's3://one/report.pdf' } } })).toBe(false)
    expect(keep({ id: 3, payload: { metadata: { source: 's3://one/notes.pdf' } } })).toBe(false)
    expect(keep({ id: 4, payload: { metadata: { source: 's3://two/report.pdf' } } })).toBe(true)
    expect([...seen]).toEqual(['s3://one/report.pdf', 's3://two/report.pdf'])
  })

  it('produces id candidates by type, none for invalid ids', () => {
    expect(candidateIds('7')).toEqual([7])
    const uid = '11111111-1111-1111-1111-111111111111'
    expect(candidateIds(uid)).toEqual([uid])
    expect(candidateIds('__nf_missing__')).toEqual([])
  })
})

describe('qdrant group values spell as their JSON', () => {
  it('keeps a boolean payload behind the segment its JSON spells', () => {
    // Python's `str(True)` and `String(true)` disagree, so both sides spell
    // a non-string value as compact JSON before comparing it to a segment.
    const seen = new Set<string>()
    const keep = exactNameTest('flag', 'true', false, seen)
    expect(keep({ id: 1, payload: { flag: true } })).toBe(true)
    expect([...seen]).toEqual(['true'])
  })
})
