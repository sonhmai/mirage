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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '../google/client.ts'

vi.mock('../google/client.ts', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../google/client.ts')
  return { ...actual, googlePost: vi.fn() }
})

import type { TokenManager } from '../google/client.ts'
import * as client from '../google/client.ts'
import { appendText } from './write.ts'

const STUB_TOKEN_MANAGER = {
  config: { clientId: 'cid', refreshToken: 'rt' },
} as TokenManager

function locationOf(): Record<string, string> | undefined {
  const payload = vi.mocked(client.googlePost).mock.calls[0]?.[2] as
    | { requests?: { insertText?: { endOfSegmentLocation?: Record<string, string> } }[] }
    | undefined
  return payload?.requests?.[0]?.insertText?.endOfSegmentLocation
}

describe('gdocs appendText', () => {
  beforeEach(() => {
    vi.mocked(client.googlePost).mockClear()
  })

  it("names no tab when none was given, which is the API's first tab", async () => {
    vi.mocked(client.googlePost).mockResolvedValue({ documentId: 'd1' })
    await appendText(STUB_TOKEN_MANAGER, 'd1', 'hello')
    expect(locationOf()).toEqual({ segmentId: '' })
  })

  it('targets the named tab', async () => {
    vi.mocked(client.googlePost).mockResolvedValue({ documentId: 'd1' })
    await appendText(STUB_TOKEN_MANAGER, 'd1', 'hello', 't.7')
    expect(locationOf()).toEqual({ segmentId: '', tabId: 't.7' })
  })

  it('treats an empty tab id as unnamed', async () => {
    // The CLI forwards whatever --tab held, and '' means the flag was
    // absent; sending it would name a tab that cannot exist.
    vi.mocked(client.googlePost).mockResolvedValue({ documentId: 'd1' })
    await appendText(STUB_TOKEN_MANAGER, 'd1', 'hello', '')
    expect(locationOf()).toEqual({ segmentId: '' })
  })

  it('posts to the batchUpdate url', async () => {
    vi.mocked(client.googlePost).mockResolvedValue({ documentId: 'd1' })
    await appendText(STUB_TOKEN_MANAGER, 'd1', 'hello')
    expect(vi.mocked(client.googlePost).mock.calls[0]?.[1]).toBe(
      'https://docs.googleapis.com/v1/documents/d1:batchUpdate',
    )
  })
})
