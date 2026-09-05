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
            flags: { lines: true },
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
  const [out] = (await wcGeneric(
    [],
    [],
    {
      stdin: ENC.encode(text),
      cwd: '/',
      filetypeFns: null,
      flags: { lines: true, words: true, bytes: true, chars: true, max_line_length: true },
    },
    async function* () {},
  ))!
  const { materialize } = await import('./types.ts')
  const values = new TextDecoder()
    .decode(await materialize(out))
    .trim()
    .split(/\s+/)
    .map(Number)
  expect(values).toEqual([1, 2, 16_388, 16_387, 16_386])
})

it('preserves a long line and its unterminated tail', async () => {
  async function* source(): AsyncIterable<Uint8Array> {
    yield ENC.encode('x'.repeat(100_000) + '\nlast')
  }
  const reader = new AsyncLineIterator(source())
  expect((await reader.readline())?.byteLength).toBe(100_000)
  expect(new TextDecoder().decode((await reader.readline())!)).toBe('last')
  expect(await reader.readline()).toBeNull()
})
