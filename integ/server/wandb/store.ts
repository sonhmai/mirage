import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fixturePath } from '../kit/typescript/fixture.ts'

export const API_KEY = '0123456789abcdef0123456789abcdef01234567'

export interface FileData {
  text?: string
  base64?: string
  repeat?: number
  mimetype?: string
  updatedAt?: string
}
export interface RunData {
  name: string
  displayName: string
  state: string
  id?: string
  tags?: string[]
  sweepName?: string | null
  group?: string | null
  jobType?: string | null
  commit?: string | null
  readOnly?: boolean | null
  createdAt: string
  heartbeatAt?: string | null
  description?: string | null
  notes?: string | null
  user?: {
    id: string
    name: string
    username?: string | null
    email?: string | null
  } | null
  systemMetrics?: Record<string, unknown> | null
  historyKeys?: Record<string, unknown>
  config: Record<string, { value: unknown }>
  summaryMetrics: Record<string, unknown>
  history?: Record<string, unknown>[]
  historyCount?: number
  singleStepHistoryEmpty?: boolean
  files: Record<string, FileData>
}
export interface Fixture {
  entities: Record<string, Record<string, RunData[]>>
  viewer: Record<string, unknown>
  projects: Record<
    string,
    {
      internalId: string
      createdAt: string
      readOnly: boolean
      description: string
      sweeps: Record<string, Record<string, unknown>>
    }
  >
}
export function loadFixture(name = 'v1', root?: string): Fixture {
  return JSON.parse(
    readFileSync(
      fixturePath('wandb', name, root === undefined ? undefined : resolve(root)),
      'utf8',
    ),
  ) as Fixture
}
export function fileBytes(file: FileData): Buffer {
  return file.base64
    ? Buffer.from(file.base64, 'base64')
    : Buffer.from((file.text ?? '').repeat(file.repeat ?? 1))
}
export function historyRows(run: RunData): Record<string, unknown>[] {
  return (
    run.history ??
    Array.from({ length: run.historyCount ?? 0 }, (_, i) => ({
      _step: i,
      train_step: i * 100,
      score: i / 2048,
    }))
  )
}
