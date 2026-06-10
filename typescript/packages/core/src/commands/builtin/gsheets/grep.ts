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

import type { GSheetsAccessor } from '../../../accessor/gsheets.ts'
import { resolveGlob } from '../../../core/gsheets/glob.ts'
import { stream as gsheetsStream } from '../../../core/gsheets/read.ts'
import { readdir as gsheetsReaddir } from '../../../core/gsheets/readdir.ts'
import { stat as gsheetsStat } from '../../../core/gsheets/stat.ts'
import { type FileStat, ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { prefixAggregate } from '../aggregators.ts'
import { grepGeneric } from '../generic/grep.ts'
import { fileReadProvision } from './provision.ts'

async function grepCommand(
  accessor: GSheetsAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  const stat = (p: PathSpec): Promise<FileStat> => gsheetsStat(accessor, p, opts.index ?? undefined)
  const readdir = (p: PathSpec): Promise<string[]> =>
    gsheetsReaddir(accessor, p, opts.index ?? undefined)
  return grepGeneric('grep', resolved, texts, opts, stat, readdir, (p) =>
    gsheetsStream(accessor, p, opts.index ?? undefined),
  )
}

export const GSHEETS_GREP = command({
  name: 'grep',
  resource: ResourceName.GSHEETS,
  spec: specOf('grep'),
  fn: grepCommand,
  aggregate: prefixAggregate,
  provision: fileReadProvision,
})
