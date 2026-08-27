import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import init, {
  canonicalize_pointer,
  encode_lfs_pointer,
  encode_remote_pointer,
  hash_pointer,
} from '../pkg/web/mirage_pointer_codec_wasm.js'

const ZERO_OID = `sha256:${'0'.repeat(64)}`
const decoder = new TextDecoder()
const wasm = await readFile(
  new URL('../pkg/web/mirage_pointer_codec_wasm_bg.wasm', import.meta.url),
)
await init({ module_or_path: wasm })

test('LFS pointer bytes and hash match the core vector', () => {
  const encoded = encode_lfs_pointer(ZERO_OID, 1_048_576n)

  assert.equal(
    decoder.decode(encoded),
    `{"kind":"lfs","oid":"${ZERO_OID}","size":1048576}`,
  )
  assert.equal(
    hash_pointer(encoded),
    'sha256:87111343709faa1eaeea2458e4724e9c88f6d33076640795954063efddd8cfda',
  )
  assert.deepEqual(canonicalize_pointer(encoded), encoded)
})

test('remote pointer uses UTF-8 and stable null fields', () => {
  const encoded = encode_remote_pointer('/data/café.json', undefined, 'v17', 42n)

  assert.equal(
    decoder.decode(encoded),
    '{"etag":null,"kind":"remote","path":"/data/café.json","size":42,"version_id":"v17"}',
  )
  assert.equal(
    hash_pointer(encoded),
    'sha256:3dedd256a35c0953506be9f8e6d73744d11d88d616f7790d255b5003817f333e',
  )
})

test('invalid OID crosses WASM as an Error', () => {
  assert.throws(() => encode_lfs_pointer('sha256:ABC', 1n), /64 lowercase hex digits/)
})

test('strict decode error crosses WASM boundary', () => {
  const unknownField = new TextEncoder().encode(
    `{"future":true,"kind":"lfs","oid":"${ZERO_OID}","size":1}`,
  )

  assert.throws(() => canonicalize_pointer(unknownField), /unknown field/)
})
