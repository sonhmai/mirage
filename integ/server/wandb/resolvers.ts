import { createHash } from 'node:crypto'
import { fileBytes, historyRows, type Fixture, type RunData } from './store.ts'

interface Page {
  after?: string | null
  first?: number | null
}
interface RunsArgs extends Page {
  filters?: string | null
  order?: string | null
}
interface HistoryArgs {
  minStep?: number | null
  maxStep?: number | null
  samples?: number | null
}

function connection<T>(rows: T[], args: Page) {
  const first = args.first ?? 50
  if (!Number.isInteger(first) || first < 0 || first > 10000) throw new Error('invalid page size')
  let start = 0
  if (args.after) {
    if (!/^cursor:[0-9]+$/.test(args.after)) throw new Error('invalid cursor')
    start = Number(args.after.slice(7))
    if (start > rows.length) throw new Error('cursor out of range')
  }
  // A deliberately small server page proves callers follow pageInfo.
  const end = Math.min(start + Math.min(first, 2), rows.length)
  return {
    edges: rows.slice(start, end).map((node, i) => ({ node, cursor: `cursor:${start + i + 1}` })),
    totalCount: rows.length,
    pageInfo: {
      endCursor: end > start ? `cursor:${end}` : null,
      startCursor: end > start ? `cursor:${start + 1}` : null,
      hasNextPage: end < rows.length,
      hasPreviousPage: start > 0,
    },
  }
}
function metric(run: RunData, key: string): unknown {
  if (key === 'created_at') return run.createdAt
  if (key.startsWith('summary_metrics.')) return run.summaryMetrics[key.slice(16)]
  if (key.startsWith('config.')) return run.config[key.slice(7)]?.value
  if (key === 'name' || key === 'displayName' || key === 'state') return run[key]
  throw new Error(`unsupported filter/order field: ${key}`)
}
function validateField(key: string): void {
  if (
    !key.startsWith('summary_metrics.') &&
    !key.startsWith('config.') &&
    !['name', 'displayName', 'state', 'created_at'].includes(key)
  )
    throw new Error(`unsupported filter/order field: ${key}`)
}
function validateFilters(filters: unknown): asserts filters is Record<string, unknown> {
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters))
    throw new Error('filters must be an object')
  for (const [key, value] of Object.entries(filters)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value) || value.length === 0) throw new Error('invalid logical filter')
      value.forEach(validateFilters)
      continue
    }
    validateField(key)
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value) || Object.keys(value).length === 0)
        throw new Error('literal array/object filters are outside this fixture')
      for (const [op, operand] of Object.entries(value)) {
        if (!['$eq', '$ne', '$in', '$exists', '$gt', '$gte', '$lt', '$lte'].includes(op))
          throw new Error(`unsupported filter operator: ${op}`)
        if (['$gt', '$gte', '$lt', '$lte'].includes(op) && typeof operand !== 'number')
          throw new Error('numeric comparison requires a number')
        if (op === '$in' && !Array.isArray(operand)) throw new Error('$in requires an array')
        if (['$eq', '$ne'].includes(op) && operand !== null && typeof operand === 'object')
          throw new Error('literal array/object filters are outside this fixture')
        if (
          op === '$in' &&
          Array.isArray(operand) &&
          operand.some((item) => item !== null && typeof item === 'object')
        )
          throw new Error('$in supports scalar operands only')
        if (op === '$exists' && typeof operand !== 'boolean')
          throw new Error('$exists requires a boolean')
      }
    }
  }
}
function equal(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => equal(item, expected))
  return expected === null ? value == null : value === expected
}
function matches(run: RunData, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, expected]) => {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(expected)) throw new Error('invalid logical filter')
      const values = expected.map((f) => matches(run, f as Record<string, unknown>))
      return key === '$and' ? values.every(Boolean) : values.some(Boolean)
    }
    const value = metric(run, key)
    if (expected === null || typeof expected !== 'object') return equal(value, expected)
    return Object.entries(expected).every(([op, operand]) => {
      if (op === '$eq') return equal(value, operand)
      if (op === '$ne') return !equal(value, operand)
      if (op === '$in' && Array.isArray(operand)) return operand.some((item) => equal(value, item))
      if (op === '$exists') return (value !== undefined) === operand
      if (['$gt', '$gte', '$lt', '$lte'].includes(op)) {
        if (typeof value !== 'number' || typeof operand !== 'number') return false
        if (op === '$gt') return value > operand
        if (op === '$gte') return value >= operand
        if (op === '$lt') return value < operand
        if (op === '$lte') return value <= operand
      }
      throw new Error(`unsupported filter operator: ${op}`)
    })
  })
}
function selectedRuns(runs: RunData[], args: RunsArgs): RunData[] {
  const filters: unknown = JSON.parse(args.filters ?? '{}')
  validateFilters(filters)
  const rows = runs.filter((run) => matches(run, filters))
  const order = args.order || '+created_at'
  {
    const descending = order.startsWith('-')
    const key = order.replace(/^[+-]/, '')
    validateField(key)
    rows.sort((a, b) => {
      const x = metric(a, key),
        y = metric(b, key)
      if (x === y) return 0
      if (x === undefined) return 1
      if (y === undefined) return -1
      const cmp =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return descending ? -cmp : cmp
    })
  }
  return rows
}
function history(
  run: RunData,
  args: HistoryArgs,
  keys?: string[],
  inclusive = false,
): Record<string, unknown>[] {
  if (
    !inclusive &&
    run.singleStepHistoryEmpty &&
    args.maxStep != null &&
    args.minStep != null &&
    args.maxStep - args.minStep === 1
  )
    return []
  const rows = historyRows(run).filter(
    (row) =>
      Number(row._step) >= (args.minStep ?? 0) &&
      (inclusive
        ? Number(row._step) <= (args.maxStep ?? Infinity)
        : Number(row._step) < (args.maxStep ?? Infinity)) &&
      (!keys || keys.every((key) => key in row)),
  )
  const samples = args.samples ?? 500
  if (!Number.isInteger(samples) || samples < 1) throw new Error('invalid samples')
  if (rows.length > samples) throw new Error('downsampling requires a captured W&B response')
  return keys ? rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]]))) : rows
}
function runNode(run: RunData, entity: string, project: string, base: string, projectId: string) {
  const files = Object.entries(run.files).map(([name, data]) => {
    const url =
      base +
      '/files/' +
      [entity, project, run.name, ...name.split('/')].map(encodeURIComponent).join('/')
    return {
      id: name,
      name,
      url: ({ upload }: { upload?: boolean | null }) => {
        if (upload) throw new Error('upload URLs are outside this read-only fixture')
        return url
      },
      directUrl:
        url.replace('127.0.0.1', 'localhost').replace('/files/', '/storage/') +
        '?signature=fixture',
      sizeBytes: fileBytes(data).length,
      md5: createHash('md5').update(fileBytes(data)).digest('base64'),
      mimetype: data.mimetype ?? 'application/octet-stream',
      updatedAt: data.updatedAt ?? run.createdAt,
    }
  })
  const rows = historyRows(run)
  return {
    ...run,
    projectId,
    id: run.id ?? `${entity}/${project}/${run.name}`,
    config: JSON.stringify(run.config),
    summaryMetrics: JSON.stringify(run.summaryMetrics),
    tags: run.tags ?? [],
    systemMetrics: run.systemMetrics == null ? null : JSON.stringify(run.systemMetrics),
    historyLineCount: rows.length,
    fileCount: files.length,
    historyKeys: run.historyKeys ?? { lastStep: rows.at(-1)?._step ?? -1, keys: {} },
    history: (args: HistoryArgs) => history(run, args).map((row) => JSON.stringify(row)),
    parquetHistory: ({ liveKeys }: { liveKeys: string[] }) => ({
      parquetUrls: [],
      liveData: rows.map((row) =>
        Object.fromEntries(liveKeys.filter((key) => key in row).map((key) => [key, row[key]])),
      ),
    }),
    sampledHistory: ({ specs }: { specs: string[] }) =>
      specs.map((raw) => {
        const spec = JSON.parse(raw) as HistoryArgs & { keys?: string[] }
        if (spec === null || Array.isArray(spec) || typeof spec !== 'object')
          throw new Error('history spec must be an object')
        for (const key of Object.keys(spec))
          if (!['minStep', 'maxStep', 'samples', 'keys'].includes(key))
            throw new Error('unsupported sampled history option')
        if (
          spec.keys !== undefined &&
          (!Array.isArray(spec.keys) || spec.keys.some((key) => typeof key !== 'string'))
        )
          throw new Error('history keys must be strings')
        return history(run, spec, spec.keys, true)
      }),
    files: (args: Page & { names?: string[]; pattern?: string }) => {
      if (args.pattern) throw new Error('file patterns are not supported by this fixture')
      return connection(
        args.names?.length ? files.filter((f) => args.names!.includes(f.name)) : files,
        args,
      )
    },
  }
}
export function rootValue(fixture: Fixture, base: string) {
  const projectNode = (entity: string, name: string) => {
    const runs = fixture.entities[entity]?.[name]
    if (!runs) return null
    const metadata = fixture.projects[`${entity}/${name}`]!
    return {
      ...metadata,
      id: `${entity}/${name}`,
      name,
      entityName: entity,
      isBenchmark: false,
      sweep: ({ sweepName }: { sweepName: string }) => metadata.sweeps[sweepName] ?? null,
      runCount: (args: RunsArgs) => selectedRuns(runs, args).length,
      run: ({ name: id }: { name: string }) => {
        const run = runs.find((r) => r.name === id)
        return run ? runNode(run, entity, name, base, metadata.internalId) : null
      },
      runs: (args: RunsArgs) =>
        connection(
          selectedRuns(runs, args).map((run) =>
            runNode(run, entity, name, base, metadata.internalId),
          ),
          args,
        ),
    }
  }
  return {
    viewer: fixture.viewer,
    models: (args: Page & { entityName: string }) => {
      const projects = fixture.entities[args.entityName]
      if (!projects) throw new Error('entity not found')
      return connection(
        Object.keys(projects).map((name) => projectNode(args.entityName, name)),
        args,
      )
    },
    project: ({ entityName, name }: { entityName: string; name: string }) =>
      projectNode(entityName, name),
  }
}
