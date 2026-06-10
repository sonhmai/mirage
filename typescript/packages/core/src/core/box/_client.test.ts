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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOX_TOKEN_URL, BoxTokenManager } from './_client.ts'

const CCG_CONFIG = { clientId: 'cid', clientSecret: 'csec', enterpriseId: '123456' }

function stubToken(token: string, expiresIn: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
        status: 200,
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('BoxTokenManager client credentials grant', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints a service-account token with the enterprise subject', async () => {
    const fetchMock = stubToken('tok1', 3600)
    const tm = new BoxTokenManager(CCG_CONFIG)
    expect(await tm.getToken()).toBe('tok1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BOX_TOKEN_URL)
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe('csec')
    expect(body.get('box_subject_type')).toBe('enterprise')
    expect(body.get('box_subject_id')).toBe('123456')
  })

  it('caches the token until expiry', async () => {
    const fetchMock = stubToken('tok1', 3600)
    const tm = new BoxTokenManager(CCG_CONFIG)
    await tm.getToken()
    await tm.getToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches once the token is past the expiry buffer', async () => {
    const fetchMock = stubToken('tok1', 100)
    const tm = new BoxTokenManager(CCG_CONFIG)
    await tm.getToken()
    await tm.getToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports no refresh token in ccg mode', async () => {
    stubToken('tok1', 3600)
    const tm = new BoxTokenManager(CCG_CONFIG)
    await tm.getToken()
    expect(tm.getRefreshToken()).toBe('')
  })

  it('requires clientSecret with enterpriseId', () => {
    expect(() => new BoxTokenManager({ clientId: 'cid', enterpriseId: '123456' })).toThrow(
      'clientSecret is required when using enterpriseId',
    )
  })

  it('requires clientId with enterpriseId', () => {
    expect(() => new BoxTokenManager({ clientSecret: 'csec', enterpriseId: '123456' })).toThrow(
      'clientId is required when using enterpriseId',
    )
  })

  it('mentions the ccg option when no auth material is given', () => {
    expect(() => new BoxTokenManager({})).toThrow('enterpriseId')
  })

  it('prefers the developer token over ccg when both are set', async () => {
    const fetchMock = stubToken('unused', 3600)
    const tm = new BoxTokenManager({ ...CCG_CONFIG, accessToken: 'devtok' })
    expect(await tm.getToken()).toBe('devtok')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces ccg token endpoint failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid_client', { status: 400 })),
    )
    const tm = new BoxTokenManager(CCG_CONFIG)
    await expect(tm.getToken()).rejects.toThrow('Box CCG token → 400')
  })
})
