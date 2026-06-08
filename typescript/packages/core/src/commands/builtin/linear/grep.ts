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

import type { LinearAccessor } from '../../../accessor/linear.ts'
import type { IndexCacheStore } from '../../../cache/index/store.ts'
import { resolveLinearGlob } from '../../../core/linear/glob.ts'
import { read as linearRead } from '../../../core/linear/read.ts'
import { readdir as linearReaddir } from '../../../core/linear/readdir.ts'
import { stat as linearStat } from '../../../core/linear/stat.ts'
import { type FileStat, type PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { grepGeneric } from '../generic/grep.ts'
import { scopeWarning } from '../utils/scope.ts'
import { fileReadProvision } from './_provision.ts'

async function* linearStream(
  accessor: LinearAccessor,
  p: PathSpec,
  index?: IndexCacheStore,
): AsyncIterable<Uint8Array> {
  yield await linearRead(accessor, p, index)
}

async function grepCommand(
  accessor: LinearAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveLinearGlob(accessor, paths, opts.index ?? undefined) : []
  const stat = (p: PathSpec): Promise<FileStat> => linearStat(accessor, p, opts.index ?? undefined)
  const readdir = (p: PathSpec): Promise<string[]> =>
    linearReaddir(accessor, p, opts.index ?? undefined)
  return grepGeneric(
    'grep',
    resolved,
    texts,
    opts,
    stat,
    readdir,
    (p) => linearStream(accessor, p, opts.index ?? undefined),
    scopeWarning,
  )
}

export const LINEAR_GREP = command({
  name: 'grep',
  resource: ResourceName.LINEAR,
  spec: specOf('grep'),
  fn: grepCommand,
  provision: fileReadProvision,
})
