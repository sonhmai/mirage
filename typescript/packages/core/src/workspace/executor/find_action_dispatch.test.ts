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
import { OpsRegistry } from '../../ops/registry.ts'
import { RAMResource } from '../../resource/ram/ram.ts'
import { MountMode } from '../../types.ts'
import { getTestParser } from '../fixtures/workspace_fixture.ts'
import { Workspace } from '../workspace/workspace.ts'

async function shellWs(): Promise<Workspace> {
  const parser = await getTestParser()
  const ops = new OpsRegistry()
  const root = new RAMResource()
  ops.registerResource(root)
  const ws = new Workspace({ '/': root }, { mode: MountMode.WRITE, ops, shellParser: parser })
  ws.createSession('s')
  return ws
}

describe('find actions', () => {
  it('substitutes the -exec head before looking it up', async () => {
    // GNU substitutes the match into the words and only then execs, so
    // `-exec {} \;` runs each match itself rather than looking up `{}`.
    const ws = await shellWs()
    try {
      const r = await ws.execute(
        "mkdir -p /data/fh/s; printf 'echo ran\\n' > /data/fh/s/x; chmod 700 /data/fh/s/x; cd /data/fh; find s -type f -exec {} \\; ; echo rc=$?",
        { sessionId: 's' },
      )
      expect(r.stdoutText).toBe('ran\nrc=0\n')
      expect(r.stderrText).toBe('')
    } finally {
      await ws.close()
    }
  })

  it("drops a deleted row's node meta", async () => {
    // A chmod that lives in the namespace overlay goes with the row, as
    // it does through `rm`, so a later file at the same name does not
    // inherit the removed one's mode.
    const ws = await shellWs()
    try {
      await ws.execute('mkdir -p /data/m; touch /data/m/f /data/m/d', { sessionId: 's' })
      await ws.namespace.setAttrs('/data/m/f', { mode: 0o600 })
      await ws.namespace.setAttrs('/data/m/d', { mode: 0o700 })
      expect(ws.namespace.metaFor('/data/m/f')).not.toBeNull()
      const r = await ws.execute('find /data/m -name f -delete; echo rc=$?', { sessionId: 's' })
      expect(r.stdoutText).toBe('rc=0\n')
      expect(ws.namespace.metaFor('/data/m/f')).toBeNull()
      expect(ws.namespace.metaFor('/data/m/d')).not.toBeNull()
    } finally {
      await ws.close()
    }
  })
})
