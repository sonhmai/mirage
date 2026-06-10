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

import type { GDriveAccessor } from '../../../accessor/gdrive.ts'
import { resolveGlob } from '../../../core/gdrive/glob.ts'
import { stat as gdriveStat } from '../../../core/gdrive/stat.ts'
import { stream as gdriveStream } from '../../../core/gdrive/read.ts'
import { isJsonlPath, isStreamableJsonlExpr } from '../../../core/jq/index.ts'
import { Precision, ProvisionResult } from '../../../provision/types.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { jqGeneric } from '../generic/jq.ts'

export async function jqProvision(
  accessor: GDriveAccessor,
  paths: PathSpec[],
  texts: string[],
  _opts: CommandOpts,
): Promise<ProvisionResult> {
  const [first] = paths
  const [expr] = texts
  if (first === undefined || expr === undefined) return new ProvisionResult({ command: 'jq' })
  try {
    const s = await gdriveStat(accessor, first)
    const fileSize = s.size ?? 0
    if (isJsonlPath(first.original) && isStreamableJsonlExpr(expr)) {
      return new ProvisionResult({
        command: `jq '${expr}' ${first.original}`,
        networkReadLow: 0,
        networkReadHigh: fileSize,
        readOps: 1,
        precision: Precision.RANGE,
      })
    }
    return new ProvisionResult({
      command: `jq '${expr}' ${first.original}`,
      networkReadLow: fileSize,
      networkReadHigh: fileSize,
      readOps: 1,
      precision: Precision.EXACT,
    })
  } catch {
    return new ProvisionResult({ command: 'jq' })
  }
}

async function jqCommand(
  accessor: GDriveAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  const stream = (p: PathSpec): AsyncIterable<Uint8Array> =>
    gdriveStream(accessor, p, opts.index ?? undefined)
  return jqGeneric(resolved, texts, opts, stream)
}

export const GDRIVE_JQ = command({
  name: 'jq',
  resource: ResourceName.GDRIVE,
  spec: specOf('jq'),
  fn: jqCommand,
  provision: jqProvision,
})
