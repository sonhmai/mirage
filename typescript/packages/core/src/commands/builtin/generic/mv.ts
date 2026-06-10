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

import type { IndexCacheStore } from '../../../cache/index/store.ts'
import { IOResult, type ByteSource } from '../../../io/types.ts'
import type { PathSpec } from '../../../types.ts'
import type { CommandFnResult } from '../../config.ts'
import { copyTargets, isDirectory, pathExists, type StatFn } from '../utils/copy.ts'

const ENC = new TextEncoder()

type RenameFn = (src: PathSpec, target: PathSpec) => Promise<void>

export async function mvGeneric(
  paths: PathSpec[],
  rename: RenameFn,
  stat: StatFn,
  noClobber: boolean,
  verbose: boolean,
  index?: IndexCacheStore,
): Promise<CommandFnResult> {
  const sources = paths.slice(0, -1)
  const dst = paths[paths.length - 1]
  if (dst === undefined) return [null, new IOResult()]
  const dstIsDir = await isDirectory(stat, dst, index)
  const writes: Record<string, ByteSource> = {}
  const lines: string[] = []
  for (const [src, target] of copyTargets(sources, dst, dstIsDir)) {
    if (noClobber && (await pathExists(stat, target))) continue
    await rename(src, target)
    writes[src.stripPrefix] = new Uint8Array()
    writes[target.stripPrefix] = new Uint8Array()
    if (verbose) lines.push(`'${src.original}' -> '${target.original}'`)
  }
  const output: ByteSource | null = lines.length > 0 ? ENC.encode(lines.join('\n') + '\n') : null
  return [output, new IOResult({ writes })]
}
