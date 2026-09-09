import type { Run, RunVariables } from './types.ts'

export function runMetadata(run: Run, variables: RunVariables): Record<string, unknown> {
  const raw = run.systemMetrics
  const systemMetrics: unknown = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null)
  return {
    ...variables,
    path: [variables.entity, variables.project, variables.run].join('/'),
    storage_id: run.id ?? null,
    display_name: run.displayName ?? null,
    state: run.state ?? null,
    tags: run.tags ?? null,
    sweep_name: run.sweepName ?? null,
    group: run.group ?? null,
    job_type: run.jobType ?? null,
    commit: run.commit ?? null,
    read_only: run.readOnly ?? null,
    created_at: run.createdAt ?? null,
    heartbeat_at: run.heartbeatAt ?? null,
    description: run.description ?? null,
    notes: run.notes ?? null,
    user: run.user ?? null,
    system_metrics: systemMetrics,
    history_line_count: run.historyLineCount ?? null,
    history_keys: run.historyKeys ?? null,
    file_count: run.fileCount ?? null,
  }
}
