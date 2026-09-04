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
import { RAMResource } from '../../resource/ram/ram.ts'
import { FileStat, FileType, MountMode } from '../../types.ts'
import { Workspace } from '../workspace/workspace.ts'
import { resolveNewerRefs } from './find_refs.ts'

function stat(virtual: string): Promise<FileStat | null> {
  if (virtual === '/w/ref') {
    return Promise.resolve(
      new FileStat({ name: 'ref', type: FileType.FILE, modified: '2020-01-01T00:00:00Z' }),
    )
  }
  return Promise.resolve(null)
}

describe('resolveNewerRefs', () => {
  it('rewrites -newer into -newermt', async () => {
    const ws = new Workspace({ '/': new RAMResource() }, { mode: MountMode.WRITE })
    const [tokens, err] = await resolveNewerRefs(
      ['-newer', 'ref', '-name', 'x', '-newer', '/w/ref'],
      ['ref', '/w/ref'],
      ws.registry,
      '/w',
      stat,
    )
    expect(err).toBeNull()
    expect(tokens).toEqual([
      '-newermt',
      '2020-01-01T00:00:00.000Z',
      '-name',
      'x',
      '-newermt',
      '2020-01-01T00:00:00.000Z',
    ])
  })

  it("reports a missing reference in GNU's words", async () => {
    const ws = new Workspace({ '/': new RAMResource() }, { mode: MountMode.WRITE })
    const [tokens, err] = await resolveNewerRefs(
      ['-newer', 'nope'],
      ['nope'],
      ws.registry,
      '/w',
      stat,
    )
    expect(tokens).toEqual(['-newer', 'nope'])
    expect(new TextDecoder().decode(err ?? new Uint8Array())).toBe(
      "find: 'nope': No such file or directory\n",
    )
  })
})
