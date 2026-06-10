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
import type { FindOptions } from '../../../resource/base.ts'
import { PathSpec } from '../../../types.ts'
import type { CommandFnResult } from '../../config.ts'
import { copyTargets, isDirectory, pathExists, type StatFn } from '../utils/copy.ts'
import { rstripSlash } from '../../../util/slash.ts'

const ENC = new TextEncoder()

type CopyFn = (src: PathSpec, target: PathSpec) => Promise<void>
type FindFn = (src: PathSpec, options: FindOptions) => Promise<string[]>

export async function cpGeneric(
  paths: PathSpec[],
  copy: CopyFn,
  find: FindFn,
  stat: StatFn,
  recursive: boolean,
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
    if (recursive) {
      const srcBase = rstripSlash(src.stripPrefix)
      const dstBase = rstripSlash(target.stripPrefix)
      for (const entry of await find(src, { type: 'f' })) {
        const entryDst = dstBase + entry.slice(srcBase.length)
        const entryDstSpec = PathSpec.fromStrPath(entryDst, target.prefix)
        if (noClobber && (await pathExists(stat, entryDstSpec))) continue
        await copy(PathSpec.fromStrPath(entry, src.prefix), entryDstSpec)
        writes[entryDst] = new Uint8Array()
        if (verbose) lines.push(`${entry} -> ${entryDst}`)
      }
      continue
    }
    if (noClobber && (await pathExists(stat, target))) continue
    await copy(src, target)
    writes[target.stripPrefix] = new Uint8Array()
    if (verbose) lines.push(`${src.original} -> ${target.original}`)
  }
  const output: ByteSource | null = lines.length > 0 ? ENC.encode(lines.join('\n') + '\n') : null
  return [output, new IOResult({ writes })]
}
