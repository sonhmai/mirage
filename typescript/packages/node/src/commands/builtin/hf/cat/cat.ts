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
  catGeneric,
  command,
  concatAggregate,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type PathSpec,
} from '@struktoai/mirage-core'
import { HF_RESOURCES, type HfAccessor } from '../../../../accessor/hf.ts'
import { resolveGlob } from '../../../../core/hf/glob.ts'
import { stat as hfStat } from '../../../../core/hf/stat.ts'
import { stream as hfStream } from '../../../../core/hf/stream.ts'
import { fileReadProvision } from '../provision.ts'

async function catCommand(
  accessor: HfAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  return catGeneric(
    resolved,
    texts,
    opts,
    (p) => hfStat(accessor, p, opts.index ?? undefined),
    (p) => hfStream(accessor, p),
  )
}

export const HF_CAT = command({
  name: 'cat',
  resource: [...HF_RESOURCES],
  spec: specOf('cat'),
  fn: catCommand,
  provision: fileReadProvision,
  aggregate: concatAggregate,
})
