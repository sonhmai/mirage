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

import type { GDocsAccessor } from '../../../accessor/gdocs.ts'
import { resolveGlob } from '../../../core/gdocs/glob.ts'
import { stream as gdocsStream } from '../../../core/gdocs/read.ts'
import { readdir as gdocsReaddir } from '../../../core/gdocs/readdir.ts'
import { stat as gdocsStat } from '../../../core/gdocs/stat.ts'
import { type FileStat, ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { prefixAggregate } from '../aggregators.ts'
import { grepGeneric } from '../generic/grep.ts'
import { fileReadProvision } from './provision.ts'

async function grepCommand(
  accessor: GDocsAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  const stat = (p: PathSpec): Promise<FileStat> => gdocsStat(accessor, p, opts.index ?? undefined)
  const readdir = (p: PathSpec): Promise<string[]> =>
    gdocsReaddir(accessor, p, opts.index ?? undefined)
  return grepGeneric('grep', resolved, texts, opts, stat, readdir, (p) =>
    gdocsStream(accessor, p, opts.index ?? undefined),
  )
}

export const GDOCS_GREP = command({
  name: 'grep',
  resource: ResourceName.GDOCS,
  spec: specOf('grep'),
  fn: grepCommand,
  aggregate: prefixAggregate,
  provision: fileReadProvision,
})
