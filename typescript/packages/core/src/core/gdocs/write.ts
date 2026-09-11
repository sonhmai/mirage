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

import { docsBase, type TokenManager, googlePost } from '../google/client.ts'

/**
 * Append text to the end of a Google Doc, or of one of its tabs.
 *
 * A request that names no tab lands on the first one, which is Google's own
 * default for every request but the three that default to all tabs
 * (replaceAllText, deleteNamedRange, replaceNamedRangeContent). Omitting
 * `tabId` therefore keeps the first-tab behaviour rather than guessing at a
 * better one; naming it is the only way to reach any other tab.
 */
export async function appendText(
  tm: TokenManager,
  docId: string,
  text: string,
  tabId?: string,
): Promise<unknown> {
  const location: Record<string, string> = { segmentId: '' }
  if (tabId !== undefined && tabId !== '') location.tabId = tabId
  const payload = {
    requests: [
      {
        insertText: {
          text,
          endOfSegmentLocation: location,
        },
      },
    ],
  }
  const url = `${docsBase(tm)}/documents/${docId}:batchUpdate`
  return googlePost(tm, url, payload)
}
