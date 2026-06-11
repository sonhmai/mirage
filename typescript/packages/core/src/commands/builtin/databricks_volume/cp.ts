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

import type { DatabricksVolumeAccessor } from '../../../accessor/databricks_volume.ts'
import type { IndexCacheStore } from '../../../cache/index/store.ts'
import { copy as dbxCopy } from '../../../core/databricks_volume/copy.ts'
import { find as dbxFind } from '../../../core/databricks_volume/find.ts'
import { resolveGlob } from '../../../core/databricks_volume/glob.ts'
import { stat as dbxStat } from '../../../core/databricks_volume/stat.ts'
import { IOResult } from '../../../io/types.ts'
import type { FindOptions } from '../../../resource/base.ts'
import { type PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { cpGeneric } from '../generic/cp.ts'

const ENC = new TextEncoder()

async function cpCommand(
  accessor: DatabricksVolumeAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  if (paths.length < 2) {
    return [null, new IOResult({ exitCode: 1, stderr: ENC.encode('cp: requires src and dst\n') })]
  }
  const resolved = await resolveGlob(accessor, paths, opts.index ?? undefined)
  const recursive = opts.flags.r === true || opts.flags.R === true || opts.flags.a === true
  return cpGeneric(
    resolved,
    (src: PathSpec, target: PathSpec) => dbxCopy(accessor, src, target),
    (src: PathSpec, options: FindOptions) => dbxFind(accessor, src, options),
    (p: PathSpec, idx?: IndexCacheStore) => dbxStat(accessor, p, idx),
    recursive,
    opts.flags.n === true,
    opts.flags.v === true,
    opts.index ?? undefined,
  )
}

export const DATABRICKS_VOLUME_CP = command({
  name: 'cp',
  resource: ResourceName.DATABRICKS_VOLUME,
  spec: specOf('cp'),
  fn: cpCommand,
  write: true,
})
