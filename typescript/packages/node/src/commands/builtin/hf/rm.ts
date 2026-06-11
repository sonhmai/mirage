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

import {
  IOResult,
  command,
  specOf,
  type ByteSource,
  type CommandFnResult,
  type CommandOpts,
  type PathSpec,
} from '@struktoai/mirage-core'
import { HF_RESOURCES, type HfAccessor } from '../../../accessor/hf.ts'
import { resolveGlob } from '../../../core/hf/glob.ts'
import { unlink as hfUnlink } from '../../../core/hf/unlink.ts'

const ENC = new TextEncoder()

// eslint-disable-next-line @typescript-eslint/require-await
async function* lines(parts: readonly string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield ENC.encode(`${part}\n`)
}

async function rmCommand(
  accessor: HfAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  if (paths.length === 0) {
    return [null, new IOResult({ exitCode: 1, stderr: ENC.encode('rm: missing operand\n') })]
  }
  if (opts.flags.r === true || opts.flags.R === true || opts.flags.d === true) {
    return [
      null,
      new IOResult({
        exitCode: 1,
        stderr: ENC.encode('rm: recursive and directory removal are not supported\n'),
      }),
    ]
  }
  const force = opts.flags.f === true
  const verbose = opts.flags.v === true
  const resolved = await resolveGlob(accessor, paths, opts.index ?? undefined)
  const verboseParts: string[] = []
  const removed: Record<string, Uint8Array> = {}
  for (const path of resolved) {
    try {
      await hfUnlink(accessor, path, opts.index ?? undefined)
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      if (code === 'EISDIR') {
        throw new Error(`rm: cannot remove '${path.original}': Is a directory`)
      }
      if (code === 'ENOENT' && force) continue
      throw err
    }
    removed[path.stripPrefix] = new Uint8Array()
    if (verbose) verboseParts.push(`removed '${path.original}'`)
  }
  const output: ByteSource | null = verbose ? lines(verboseParts) : null
  return [output, new IOResult({ writes: removed })]
}

export const HF_RM = command({
  name: 'rm',
  resource: [...HF_RESOURCES],
  spec: specOf('rm'),
  fn: rmCommand,
  write: true,
})
