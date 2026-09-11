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

import type { JsonValue } from '../../kit/typescript/index.ts'
import type { GwsState } from '../store/state.ts'
import type { DocBody, DocTab } from '../store/types.ts'
import type { JsonObj } from '../wire/json.ts'

// The flat text string is authoritative; the Document body JSON is rebuilt
// from it on read with real index arithmetic (offset 1 sits right after the
// sectionBreak slot, each paragraph carries its trailing newline).
export function buildDocBody(text: string): { content: JsonValue[] } {
  const content: JsonValue[] = [
    {
      startIndex: 1,
      endIndex: 1,
      sectionBreak: {
        sectionStyle: {
          columnSeparatorStyle: 'NONE',
          contentDirection: 'LEFT_TO_RIGHT',
          sectionType: 'CONTINUOUS',
        },
      },
    },
  ]
  const normalized = text + '\n'
  let cursor = 1
  const paragraphs = normalized.split('\n')
  if (paragraphs[paragraphs.length - 1] === '') paragraphs.pop()
  for (const para of paragraphs) {
    const paraText = para + '\n'
    const startIndex = cursor
    const endIndex = cursor + paraText.length
    content.push({
      startIndex,
      endIndex,
      paragraph: {
        elements: [{ startIndex, endIndex, textRun: { content: paraText, textStyle: {} } }],
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT', direction: 'LEFT_TO_RIGHT' },
      },
    })
    cursor = endIndex
  }
  return { content }
}

// A fresh document's only tab. Google names it "Tab 1" and mints an opaque
// id; the fake's is positional so truth files stay stable across runs.
export function initialDocTab(text = ''): DocTab {
  return { tabId: 't.0', title: 'Tab 1', text, childTabs: [] }
}

// Pre-order, which is the order the API reports tabs in and therefore the
// order `replaceAllText` visits them in when no tabsCriteria narrows it.
export function allDocTabs(doc: DocBody): DocTab[] {
  const out: DocTab[] = []
  const walk = (tabs: DocTab[]): void => {
    for (const tab of tabs) {
      out.push(tab)
      walk(tab.childTabs)
    }
  }
  walk(doc.tabs)
  return out
}

// The tab a request with no tabId lands on, which the API documents as the
// first tab. A document always has one, so a caller never has to branch.
export function firstTabOf(doc: DocBody): DocTab {
  const first = doc.tabs[0]
  if (first === undefined) throw new Error('a document always has one tab')
  return first
}

export function findDocTab(doc: DocBody, tabId: string): DocTab | undefined {
  return allDocTabs(doc).find((t) => t.tabId === tabId)
}

// Every tab's text, in reporting order. This is what an export or a
// fullText search sees, because both are about the document rather than
// about one of its tabs.
export function docPlainText(doc: DocBody): string {
  return allDocTabs(doc)
    .map((t) => t.text)
    .join('\n')
}

export function copyDocTabs(tabs: DocTab[]): DocTab[] {
  return tabs.map((t) => ({ ...t, childTabs: copyDocTabs(t.childTabs) }))
}

function fmtTab(tab: DocTab, index: number, parentTabId: string | null, nesting: number): JsonObj {
  const tabProperties: JsonObj = { tabId: tab.tabId, title: tab.title, index }
  // Both are ABSENT on a root tab, probed against the live API on
  // 2026-09-10: a real root tab answers with exactly
  // {index, tabId, title}. `nestingLevel` is documented output-only and
  // Google does not send it at depth 0 even though it sends `index: 0`,
  // so emitting a 0 here would invent a field a caller could come to
  // depend on and then find missing in production, which is the same
  // trap includeTabsContent itself set.
  if (parentTabId !== null) {
    tabProperties.parentTabId = parentTabId
    tabProperties.nestingLevel = nesting
  }
  const out: JsonObj = { tabProperties, documentTab: { body: buildDocBody(tab.text) } }
  if (tab.childTabs.length > 0) {
    out.childTabs = tab.childTabs.map((child, i) => fmtTab(child, i, tab.tabId, nesting + 1))
  }
  return out
}

/**
 * The documents.get response, in one of its two exclusive shapes.
 *
 * `includeTabsContent` is not a verbosity knob, it is a shape switch: with
 * it the content lives under `tabs[]` and the singleton fields are left
 * empty, and without it the singleton fields carry the FIRST tab while
 * `tabs` stays empty. Filling both would be the one thing a fake must not
 * do here, because it would let a caller that still reads `.body` pass
 * against a multi-tab document that the real API answers with an empty
 * `.body`.
 */
export function fmtDocument(st: GwsState, id: string, includeTabsContent: boolean): JsonObj {
  const doc = st.docs.get(id) as DocBody
  const file = st.files.get(id)
  const revisionId = `rev-${String(file?.revisions.length ?? 0)}`
  if (includeTabsContent) {
    return {
      documentId: id,
      title: doc.title,
      tabs: doc.tabs.map((tab, i) => fmtTab(tab, i, null, 0)),
      revisionId,
    }
  }
  return {
    documentId: id,
    title: doc.title,
    body: buildDocBody(firstTabOf(doc).text),
    revisionId,
  }
}

// SubstringMatchCriteria.matchCase defaults to false, i.e. the search is
// case-INSENSITIVE unless the caller opts in. Shared by the Docs and Slides
// replaceAllText requests.
//
// Windows are compared at equal length rather than by lowercasing the whole
// haystack: a lowercase mapping can change a string's length, which would
// misalign every index after it.
export function replaceAllText(
  haystack: string,
  needle: string,
  replacement: string,
  matchCase: boolean,
): [string, number] {
  if (needle === '') return [haystack, 0]
  const find = matchCase ? needle : needle.toLowerCase()
  let out = ''
  let cursor = 0
  let count = 0
  while (cursor + needle.length <= haystack.length) {
    const window = haystack.slice(cursor, cursor + needle.length)
    if ((matchCase ? window : window.toLowerCase()) === find) {
      out += replacement
      cursor += needle.length
      count += 1
    } else {
      out += haystack[cursor] as string
      cursor += 1
    }
  }
  return [out + haystack.slice(cursor), count]
}
