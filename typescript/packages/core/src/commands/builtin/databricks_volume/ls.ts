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
import { resolveGlob } from '../../../core/databricks_volume/glob.ts'
import { readdir as dbxReaddir } from '../../../core/databricks_volume/readdir.ts'
import { stat as dbxStat } from '../../../core/databricks_volume/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { lsGeneric } from '../generic/ls.ts'
import { metadataProvision } from './provision.ts'

async function lsCommand(
  accessor: DatabricksVolumeAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  return lsGeneric(
    resolved,
    opts,
    (p) => dbxReaddir(accessor, p, opts.index ?? undefined),
    (p) => dbxStat(accessor, p, opts.index ?? undefined),
  )
}

export const DATABRICKS_VOLUME_LS = command({
  name: 'ls',
  resource: ResourceName.DATABRICKS_VOLUME,
  spec: specOf('ls'),
  fn: lsCommand,
  provision: metadataProvision,
})
