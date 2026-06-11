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
import { OpsRegistry } from '../ops/registry.ts'
import { RAMResource } from '../resource/ram/ram.ts'
import { MountMode } from '../types.ts'
import { getTestParser, stdoutStr } from './fixtures/workspace_fixture.ts'
import { Workspace } from './workspace.ts'

// POSIX: `grep -e pat file` must behave like `grep pat file`. The pattern
// positional used to consume the file path even when -e supplied the pattern,
// leaving paths() empty and grep exiting 1 with no output.

const ENC = new TextEncoder()

async function makeWs(): Promise<Workspace> {
  const parser = await getTestParser()
  const r = new RAMResource()
  r.store.dirs.add('/')
  r.store.dirs.add('/data')
  r.store.files.set('/data/a.txt', ENC.encode('orange line\nplain line\n'))
  const registry = new OpsRegistry()
  registry.registerResource(r)
  return new Workspace({ '/': r }, { mode: MountMode.WRITE, ops: registry, shellParser: parser })
}

describe('grep -e pattern flag', () => {
  it('matches like a positional pattern', async () => {
    const ws = await makeWs()
    const io = await ws.execute('grep -e orange /data/a.txt')
    expect(io.exitCode).toBe(0)
    expect(stdoutStr(io)).toBe('orange line\n')
    await ws.close()
  })

  it('positional pattern still works', async () => {
    const ws = await makeWs()
    const io = await ws.execute('grep orange /data/a.txt')
    expect(io.exitCode).toBe(0)
    expect(stdoutStr(io)).toBe('orange line\n')
    await ws.close()
  })
})
