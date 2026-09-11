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
import { EXTERNAL_COMMANDS } from '../../../runtime/constants.ts'
import { Runtime } from '../../../runtime/base.ts'
import { PROCESS_EXECUTOR, type ProcessExecutor } from '../../../runtime/mixin.ts'
import type { ProcessExecution, RunResult, RuntimeOptions } from '../../../runtime/types.ts'
import { RAMResource } from '../../../resource/ram/ram.ts'
import { MountMode } from '../../../types.ts'
import { Workspace } from '../../workspace/workspace.ts'
import { getTestParser } from '../../fixtures/workspace_fixture.ts'

const ENC = new TextEncoder()
const DEC = new TextDecoder()

class ProcessProbe extends Runtime implements ProcessExecutor {
  readonly [PROCESS_EXECUTOR] = true as const
  name = 'probe'
  requests: ProcessExecution[] = []
  constructor(options: RuntimeOptions = {}) {
    super(options, [EXTERNAL_COMMANDS])
  }
  runProcess(request: ProcessExecution): Promise<RunResult> {
    this.requests.push(request)
    return Promise.resolve({
      stdout: request.stdin ?? ENC.encode('GPU ready\nother\n'),
      stderr: null,
      exitCode: 0,
    })
  }
}

async function workspace(probe: ProcessProbe, others: ProcessProbe[] = []): Promise<Workspace> {
  return new Workspace(
    { '/': new RAMResource() },
    {
      mode: MountMode.EXEC,
      shellParser: await getTestParser(),
      runtimes: [probe, ...others],
    },
  )
}

describe('external program capture', () => {
  it('preserves Mirage pipes and VFS redirects', async () => {
    const probe = new ProcessProbe()
    const ws = await workspace(probe)
    try {
      const result = await ws.execute("printf 'GPU ready\nother\n' | native-tool | grep GPU > /out")
      expect(result.exitCode).toBe(0)
      expect(DEC.decode(result.stdout)).toBe('')
      expect(DEC.decode((await ws.execute('cat /out')).stdout)).toBe('GPU ready\n')
      expect(probe.requests).toHaveLength(1)
      expect(probe.requests[0]?.argv).toEqual(['native-tool'])
      expect(DEC.decode(probe.requests[0]?.stdin ?? undefined)).toBe('GPU ready\nother\n')
    } finally {
      await ws.close()
    }
  })

  it('preserves empty argv and native interpreter options, cwd and temporary env', async () => {
    const probe = new ProcessProbe({ captures: ['python3', EXTERNAL_COMMANDS] })
    const ws = await workspace(probe)
    try {
      await ws.execute('mkdir /work; cd /work')
      const result = await ws.execute(
        "TOKEN=one python3 -c 'print(1)' -u 'a b' '$(echo literal)' ''",
      )
      expect(result.exitCode).toBe(0)
      expect(probe.requests[0]?.argv).toEqual([
        'python3',
        '-c',
        'print(1)',
        '-u',
        'a b',
        '$(echo literal)',
        '',
      ])
      expect(probe.requests[0]?.cwd.virtual).toBe('/work')
      expect(probe.requests[0]?.env.TOKEN).toBe('one')
      await ws.execute('native-tool')
      expect(probe.requests[1]?.env.TOKEN).toBeUndefined()
    } finally {
      await ws.close()
    }
  })

  it('expands globs against the workspace and preserves quoted patterns', async () => {
    const probe = new ProcessProbe()
    const ws = await workspace(probe)
    try {
      await ws.execute('mkdir /work; touch /work/a.txt /work/b.txt')
      const result = await ws.execute("native-tool /work/*.txt '/work/*.txt'")
      expect(result.exitCode).toBe(0)
      expect(probe.requests[0]?.argv).toEqual([
        'native-tool',
        '/work/a.txt',
        '/work/b.txt',
        '/work/*.txt',
      ])
    } finally {
      await ws.close()
    }
  })

  it('never uses the external fallback for a refused named capture', async () => {
    const probe = new ProcessProbe({ captures: ['native-tool'], script: () => false })
    const fallback = new ProcessProbe()
    fallback.name = 'fallback'
    const ws = await workspace(probe, [fallback])
    try {
      expect((await ws.execute('native-tool')).exitCode).toBe(126)
      expect(probe.requests).toHaveLength(0)
      expect(fallback.requests).toHaveLength(0)
      expect((await ws.execute('another-tool')).exitCode).toBe(0)
      expect(fallback.requests).toHaveLength(1)
    } finally {
      await ws.close()
    }
  })

  it('keeps Mirage available when the external runtime refuses a line', async () => {
    const probe = new ProcessProbe({ script: () => false })
    const ws = await workspace(probe)
    try {
      expect((await ws.execute('native-tool')).exitCode).toBe(126)
      expect(DEC.decode((await ws.execute('echo mirage')).stdout)).toBe('mirage\n')
      expect(probe.requests).toHaveLength(0)
    } finally {
      await ws.close()
    }
  })

  it('names the external route and keeps shell functions in Mirage', async () => {
    const probe = new ProcessProbe()
    const ws = await workspace(probe)
    try {
      expect(DEC.decode((await ws.execute('type -t native-tool')).stdout)).toBe('external\n')
      await ws.execute('native-tool() { echo function; }')
      expect(DEC.decode((await ws.execute('native-tool')).stdout)).toBe('function\n')
      expect(probe.requests).toHaveLength(0)
    } finally {
      await ws.close()
    }
  })
})
