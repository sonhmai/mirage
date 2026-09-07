/* eslint-disable @typescript-eslint/require-await -- Immediately ready producers reproduce event-loop starvation. */
import { RAMFileCacheStore } from '../cache/file/ram.ts'
import { describe, expect, it } from 'vitest'
import { AsyncLineIterator } from './async_line_iterator.ts'
import { wcGeneric } from '../commands/builtin/generic/wc.ts'

const ENC = new TextEncoder()

describe('cooperative processing', () => {
  it('lets timers run during direct readline calls', async () => {
    let fired = false
    const timer = setTimeout(() => {
      fired = true
    }, 1)
    async function* source(): AsyncIterable<Uint8Array> {
      yield ENC.encode('line\n'.repeat(500_000))
    }
    try {
      const reader = new AsyncLineIterator(source())
      for (let i = 0; i < 500_000; i++) await reader.readline()
      expect(fired).toBe(true)
    } finally {
      clearTimeout(timer)
    }
  })

  it('aborts wc and closes its producer before returning', async () => {
    const controller = new AbortController()
    let closed = false
    async function* source(): AsyncIterable<Uint8Array> {
      try {
        yield ENC.encode('line\n'.repeat(500_000))
      } finally {
        closed = true
      }
    }
    const timer = setTimeout(() => {
      controller.abort()
    }, 1)
    try {
      await expect(
        wcGeneric(
          [],
          [],
          {
            stdin: source(),
            flags: {},
            cwd: '/',
            filetypeFns: null,
            signal: controller.signal,
          },
          source,
        ),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(closed).toBe(true)
    } finally {
      clearTimeout(timer)
    }
  })
})

it('preserves UTF-8 and words across bounded chunks', async () => {
  const text = 'a'.repeat(16_383) + 'é x\n'
  const result = await wcGeneric(
    [],
    [],
    {
      stdin: ENC.encode(text),
      cwd: '/',
      filetypeFns: null,
      flags: { lines: true, words: true, bytes: true, chars: true, max_line_length: true },
    },
    async function* () {
      yield new Uint8Array()
    },
  )
  if (result === null) throw new Error('wc returned no result')
  const [out] = result
  const { materialize } = await import('./types.ts')
  const values = new TextDecoder()
    .decode(await materialize(out))
    .trim()
    .split(/\s+/)
    .map(Number)
  expect(values).toEqual([1, 2, 16_387, 16_388, 16_386])
})

it('preserves a long line and its unterminated tail', async () => {
  async function* source(): AsyncIterable<Uint8Array> {
    yield ENC.encode('x'.repeat(100_000) + '\nlast')
  }
  const reader = new AsyncLineIterator(source())
  expect((await reader.readline())?.byteLength).toBe(100_000)
  expect(new TextDecoder().decode((await reader.readline()) ?? undefined)).toBe('last')
  expect(await reader.readline()).toBeNull()
})

it('allows timer progress while populating a file-cache fingerprint', async () => {
  const cache = new RAMFileCacheStore()
  let fired = false
  const timer = setTimeout(() => {
    fired = true
  }, 1)
  try {
    await cache.set('/big', new Uint8Array(20_000_000))
    expect(fired).toBe(true)
  } finally {
    clearTimeout(timer)
  }
})

it.each(['set', 'add'] as const)(
  'discards a pending %s when the cache is cleared',
  async (operation) => {
    const cache = new RAMFileCacheStore()
    const pending = cache[operation]('/large', new Uint8Array(20_000_000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await cache.clear()
    await pending
    expect(await cache.get('/large')).toBeNull()
    expect(cache.cacheSize).toBe(0)
  },
)

it.each(['mapfile values', 'read -N 131072 value'])(
  'aborts %s while consuming ready stdin and closes the producer',
  async (command) => {
    const { Workspace } = await import('../workspace/workspace/workspace.ts')
    const { getTestParser } = await import('../workspace/fixtures/workspace_fixture.ts')
    const ws = new Workspace({}, { shellParser: await getTestParser() })
    const controller = new AbortController()
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function* source(): AsyncIterable<Uint8Array> {
      try {
        timer = setTimeout(() => {
          controller.abort()
        }, 0)
        yield ENC.encode('line\n'.repeat(200_000))
      } finally {
        closed = true
      }
    }
    try {
      await expect(
        ws.execute(command, { stdin: source(), signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(closed).toBe(true)
    } finally {
      clearTimeout(timer)
      await ws.close()
    }
  },
)

it('uses the current read signal when reusing buffered stdin', async () => {
  let closed = false
  async function* source(): AsyncIterable<Uint8Array> {
    try {
      yield ENC.encode('first\nsecond\nthird\n')
    } finally {
      closed = true
    }
  }
  const reader = new AsyncLineIterator(source())
  const previous = new AbortController()
  expect(new TextDecoder().decode((await reader.readUntil(10, previous.signal))[0])).toBe('first')
  previous.abort()
  const current = new AbortController()
  expect(new TextDecoder().decode((await reader.readUntil(10, current.signal))[0])).toBe('second')
  current.abort()
  await expect(reader.readUntil(10, current.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(closed).toBe(true)
})
