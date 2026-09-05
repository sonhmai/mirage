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

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { IOResult } from '../../io/types.ts'
import { RAMResource } from '../../resource/ram/ram.ts'
import { type JobRunner, JobStatus } from '../../shell/job_table/index.ts'
import type { ShellParser } from '../../shell/parse/index.ts'
import { MountMode } from '../../types.ts'
import { ExecutionNode } from '../types.ts'
import { getTestParser } from '../fixtures/workspace_fixture.ts'
import { Workspace } from './workspace.ts'

let parser: ShellParser

beforeAll(async () => {
  parser = await getTestParser()
})

function buildWs(): Workspace {
  return new Workspace(
    { '/m': [new RAMResource(), MountMode.WRITE] },
    { mode: MountMode.WRITE, shellParser: parser },
  )
}

/**
 * A runner that never observes the abort signal, like a long command
 * that does not check it. Only `release.fire()` ends it.
 *
 * Deliberately not `sleep`: it is the one command that consumes the
 * signal, so it settles through its own runner and would pass even when
 * teardown only aborts.
 */
function deaf(release: { fire?: () => void }): JobRunner {
  return async () => {
    await new Promise<void>((resolve) => {
      release.fire = resolve
    })
    return [new IOResult(), new ExecutionNode()]
  }
}

describe('closeWorkspace', () => {
  // A bare abort leaves such a job RUNNING with no ending chunk, so
  // anyone parked on waitFinished waits forever on a workspace that is
  // already gone. killAll never joins the runner, so settling here
  // cannot block shutdown on a job that is mid-write.
  it('settles a job whose runner never observes the abort', async () => {
    const ws = buildWs()
    const release: { fire?: () => void } = {}
    const job = ws.jobTable.submit({
      command: 'long',
      run: deaf(release),
      abort: new AbortController(),
      cwd: '/',
    })
    expect(job.status).toBe(JobStatus.RUNNING)

    await ws.close()

    expect(job.status).toBe(JobStatus.KILLED)
    expect(job.exitCode).toBe(137)
    await job.console.waitFinished()

    // The runner unwinding afterwards must not reopen or relabel it.
    release.fire?.()
    await Promise.resolve()
    expect(job.status).toBe(JobStatus.KILLED)
  })

  it('is idempotent with a job running', async () => {
    const ws = buildWs()
    const release: { fire?: () => void } = {}
    const job = ws.jobTable.submit({
      command: 'long',
      run: deaf(release),
      abort: new AbortController(),
      cwd: '/',
    })

    await ws.close()
    await ws.close()

    expect(job.status).toBe(JobStatus.KILLED)
    release.fire?.()
  })
})

it.each([
  { secondary: false, failure: false },
  { secondary: false, failure: true },
  { secondary: true, failure: false },
  { secondary: true, failure: true },
])(
  'close settles profile persistence (secondary=$secondary, failure=$failure)',
  async ({ secondary, failure }) => {
    const ws = buildWs()
    await ws.ensureSessionsLoaded()
    ws.createSession('peer')
    await ws.flushSessions()
    const sessionId = secondary ? 'peer' : ws.defaultSessionId
    const store = ws.stateStore.sessions(ws.workspaceId)
    const events: string[] = []
    let enter = (): void => undefined
    let resume = (): void => undefined
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const release = new Promise<void>((resolve) => {
      resume = resolve
    })
    const casSet = store.casSet.bind(store)
    const closeStore = ws.stateStore.close.bind(ws.stateStore)
    vi.spyOn(store, 'casSet').mockImplementation(async (...args) => {
      enter()
      await release
      try {
        expect(events).not.toContain('store-closed')
        if (failure) throw new Error('store unavailable')
        return await casSet(...args)
      } finally {
        events.push('write-finished')
      }
    })
    vi.spyOn(ws.stateStore, 'close').mockImplementation(async () => {
      events.push('store-closed')
      await closeStore()
    })
    const updating = ws.setSessionProfile(sessionId, { paths: { hide: ['/data/secret'] } }).then(
      (value) => value,
      (error: unknown) => error,
    )
    let closing: Promise<void> | undefined
    let closed = false
    try {
      await entered
      closing = ws.close().then(() => {
        closed = true
      })
      await Promise.resolve()
      expect(closed).toBe(false)
      expect(events).toEqual([])
      await expect(ws.setSessionProfile(sessionId, {})).rejects.toThrow('Workspace is closed')
      const finished = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false)
          }, 30)
        }),
      ])
      expect(finished).toBe(false)
      resume()
      expect(await updating).toEqual(
        failure ? new Error('store unavailable') : ws.getSession(sessionId),
      )
      await closing
      expect(events).toEqual(['write-finished', 'store-closed'])
    } finally {
      resume()
      await updating
      await closing
      await ws.close()
    }
  },
)
