import { describe, expect, it } from 'vitest'
import { runMetadata } from './metadata.ts'

const variables = { entity: 'lab', project: 'experiments', run: 'run-a' }

describe('W&B run metadata', () => {
  it('uses null for unavailable metadata', () => {
    const result = runMetadata({ name: 'run-a' }, variables)
    expect(result.path).toBe('lab/experiments/run-a')
    expect(result.run).toBe('run-a')
    for (const key of [
      'storage_id',
      'sweep_name',
      'user',
      'created_at',
      'heartbeat_at',
      'system_metrics',
      'tags',
      'history_line_count',
      'file_count',
      'read_only',
    ])
      expect(result[key]).toBeNull()
  })
  it.each([false, true])('preserves system metrics when encoded=%s', (encoded) => {
    const metrics = { cpu: 0, memory: 1.5, nested: { missing: null }, label: 'café' }
    expect(
      runMetadata(
        { name: 'run-a', systemMetrics: encoded ? JSON.stringify(metrics) : metrics },
        variables,
      ).system_metrics,
    ).toEqual(metrics)
  })
  it('preserves empty values and run identity', () => {
    const result = runMetadata(
      {
        name: 'run-a',
        id: 'opaque-storage-id',
        displayName: 'duplicate',
        tags: [],
        notes: '',
        group: '',
        readOnly: false,
        fileCount: 0,
        historyLineCount: 0,
        createdAt: '2026-01-01T08:00:00+08:00',
        user: { id: 'opaque-user-id', name: '', username: 'bob', email: null },
        historyKeys: { lastStep: -1, keys: {} },
        config: { lr: { value: 0.01 } },
        summaryMetrics: { score: 0.9 },
      },
      variables,
    )
    expect(result).toMatchObject({
      run: 'run-a',
      storage_id: 'opaque-storage-id',
      display_name: 'duplicate',
      tags: [],
      notes: '',
      group: '',
      read_only: false,
      file_count: 0,
      history_line_count: 0,
      created_at: '2026-01-01T08:00:00+08:00',
      user: { id: 'opaque-user-id', name: '', username: 'bob', email: null },
      history_keys: { lastStep: -1, keys: {} },
    })
    expect(result).not.toHaveProperty('config')
    expect(result).not.toHaveProperty('summaryMetrics')
  })
  it.each(['', 'malformed'])('rejects malformed system metrics %s', (raw) => {
    expect(() => runMetadata({ name: 'run-a', systemMetrics: raw }, variables)).toThrow(SyntaxError)
  })
})
