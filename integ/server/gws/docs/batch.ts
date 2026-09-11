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

import type { JsonValue, Reply } from '../../kit/typescript/index.ts'
import { touchNative } from '../drive/item.ts'
import type { GwsState } from '../store/state.ts'
import { asBool, asNum, asObj, asStr, asStrArr } from '../wire/json.ts'
import type { JsonObj } from '../wire/json.ts'
import { NOT_FOUND, googleError, ok } from '../wire/reply.ts'
import type { DocBody, DocTab } from '../store/types.ts'
import { allDocTabs, copyDocTabs, findDocTab, firstTabOf, replaceAllText } from './body.ts'

// The tab a location-bearing request applies to. A request that names no
// tab lands on the FIRST one, which is the API's documented default for
// every request but the three that instead default to all tabs.
//
// An unknown tabId is refused rather than silently redirected to the
// first: a caller that mistyped one would otherwise see a successful
// write land somewhere it never named.
function tabFor(doc: DocBody, location: JsonObj): DocTab | null {
  const tabId = asStr(location.tabId)
  if (tabId === undefined || tabId === '') return firstTabOf(doc)
  return findDocTab(doc, tabId) ?? null
}

const UNKNOWN_TAB = 'Invalid requests: tabId not found in the document'

/**
 * Apply a batch, all of it or none of it.
 *
 * "Each request is validated before being applied. If any request is not
 * valid, then the entire request will fail and nothing will be applied."
 * So the batch runs against a COPY of the tabs and commits only once every
 * request has succeeded. Mutating in place and returning early on the
 * second request left the first one applied, and the write route persists
 * unconditionally, so a caller retrying the failed batch would have
 * duplicated it.
 */
export function docsBatchUpdate(st: GwsState, id: string, requests: JsonObj[]): Reply {
  const live = st.docs.get(id)
  if (live === undefined) return NOT_FOUND
  const doc: DocBody = { title: live.title, tabs: copyDocTabs(live.tabs) }
  const replies: JsonValue[] = []
  for (const request of requests) {
    if ('insertText' in request) {
      const r = asObj(request.insertText)
      const text = asStr(r.text) ?? ''
      const location = asObj(r.location)
      const endOfSegment = asObj(r.endOfSegmentLocation)
      const index = asNum(location.index)
      // Whichever of the two location shapes the request used carries the
      // tabId, so both are consulted rather than only the indexed one.
      const tab = tabFor(doc, index === undefined ? endOfSegment : location)
      if (tab === null) return googleError(400, UNKNOWN_TAB, 'INVALID_ARGUMENT')
      if (index !== undefined) {
        const offset = Math.max(0, Math.min(tab.text.length, index - 1))
        tab.text = tab.text.slice(0, offset) + text + tab.text.slice(offset)
      } else {
        tab.text += text
      }
      replies.push({})
    } else if ('deleteContentRange' in request) {
      const range = asObj(asObj(request.deleteContentRange).range)
      const tab = tabFor(doc, range)
      if (tab === null) return googleError(400, UNKNOWN_TAB, 'INVALID_ARGUMENT')
      const start = Math.max(0, (asNum(range.startIndex) ?? 1) - 1)
      const end = Math.max(start, (asNum(range.endIndex) ?? 1) - 1)
      tab.text = tab.text.slice(0, start) + tab.text.slice(end)
      replies.push({})
    } else if ('replaceAllText' in request) {
      const r = asObj(request.replaceAllText)
      const contains = asObj(r.containsText)
      // One of the three requests that default to ALL tabs rather than to
      // the first, so an absent tabsCriteria means every tab and the
      // reply counts the occurrences across all of them.
      const named = asStrArr(asObj(r.tabsCriteria).tabIds)
      let targets: DocTab[]
      if (named === undefined || named.length === 0) {
        targets = allDocTabs(doc)
      } else {
        targets = []
        for (const tabId of named) {
          const tab = findDocTab(doc, tabId)
          if (tab === undefined) return googleError(400, UNKNOWN_TAB, 'INVALID_ARGUMENT')
          targets.push(tab)
        }
      }
      let occurrences = 0
      for (const tab of targets) {
        const [text, changed] = replaceAllText(
          tab.text,
          asStr(contains.text) ?? '',
          asStr(r.replaceText) ?? '',
          asBool(contains.matchCase) ?? false,
        )
        tab.text = text
        occurrences += changed
      }
      replies.push({ replaceAllText: { occurrencesChanged: occurrences } })
    } else {
      return googleError(
        400,
        `Unsupported request: ${Object.keys(request).join(',')}`,
        'INVALID_ARGUMENT',
      )
    }
  }
  // Every request succeeded, so the copy becomes the document.
  live.tabs = doc.tabs
  touchNative(st, id)
  return ok({ documentId: id, replies })
}
