import { expect, it, vi } from 'vitest'
import { WandbResource } from './wandb.ts'
import { normalizeWandbConfig } from '../../core/wandb/config.ts'
import { Workspace } from '../../workspace/workspace/workspace.ts'
import { getTestParser } from '../../workspace/fixtures/workspace_fixture.ts'
import { MountMode } from '../../types.ts'

it('isolates mount scopes and directory indexes', async () => {
  const resources = [
    new WandbResource(normalizeWandbConfig({ entities: ['lab', 'lab'] })),
    new WandbResource(normalizeWandbConfig({ entities: ['other'] })),
  ]
  const requests = resources.map((resource) => vi.spyOn(resource.accessor.client, 'request'))
  const shellParser = await getTestParser()
  const workspaces = resources.map(
    (resource) => new Workspace({ '/wandb': resource }, { shellParser }),
  )
  try {
    for (const [i, ws] of workspaces.entries()) {
      const result = await ws.execute('ls /wandb')
      expect(result.exitCode).toBe(0)
      expect(new TextDecoder().decode(result.stdout).trim()).toBe(i === 0 ? 'lab' : 'other')
      expect((await ws.execute(`ls /wandb/${i === 0 ? 'other' : 'lab'}`)).exitCode).not.toBe(0)
    }
    for (const request of requests) expect(request).not.toHaveBeenCalled()
  } finally {
    for (const ws of workspaces) await ws.close()
  }
})

it('refuses W&B mutations and CLI dispatch even in a write workspace', async () => {
  const resource = new WandbResource(normalizeWandbConfig({ entities: ['lab'] }))
  const request = vi.spyOn(resource.accessor.client, 'request')
  const ws = new Workspace(
    { '/wandb': resource },
    {
      mode: MountMode.WRITE,
      shellParser: await getTestParser(),
    },
  )
  try {
    for (const command of [
      'echo bad > /wandb/lab/project/run/summary.json',
      'mkdir /wandb/lab/new-project',
      'type -t wandb',
    ])
      expect((await ws.execute(command)).exitCode).not.toBe(0)
    expect(request).not.toHaveBeenCalled()
  } finally {
    await ws.close()
  }
})
