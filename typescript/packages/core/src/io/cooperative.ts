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
import { CachableAsyncIterator } from './cachable_iterator.ts'
import { Checkpoint } from './checkpoint.ts'

export const CHUNK_SIZE = 16 * 1024

/** Split even a single RAM/cache blob; for-await closes producers on abort. */
export async function* chunks(
  source: Uint8Array | AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterableIterator<Uint8Array> {
  const checkpoint = new Checkpoint(signal)
  if (source instanceof Uint8Array) {
    for (let offset = 0; offset < source.byteLength; offset += CHUNK_SIZE) {
      const pending = checkpoint.run()
      if (pending !== undefined) await pending
      yield source.subarray(offset, offset + CHUNK_SIZE)
    }
    return
  }
  try {
    for await (const data of source) {
      for (let offset = 0; offset < data.byteLength; offset += CHUNK_SIZE) {
        const pending = checkpoint.run()
        if (pending !== undefined) await pending
        yield data.subarray(offset, offset + CHUNK_SIZE)
      }
    }
  } catch (error) {
    if (source instanceof CachableAsyncIterator) await source.discard()
    throw error
  }
}
