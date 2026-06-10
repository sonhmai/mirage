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

import type { RAMAccessor } from '../../../accessor/ram.ts'
import { rename as ramRename } from '../../../core/ram/rename.ts'
import { stat as ramStat } from '../../../core/ram/stat.ts'
import { IOResult } from '../../../io/types.ts'
import { type PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { mvGeneric } from '../generic/mv.ts'

function mvCommand(
  accessor: RAMAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  if (paths.length < 2) {
    return Promise.resolve([
      null,
      new IOResult({ exitCode: 1, stderr: new TextEncoder().encode('mv: missing operand\n') }),
    ])
  }
  return mvGeneric(
    paths,
    (src: PathSpec, target: PathSpec) => ramRename(accessor, src, target),
    (p: PathSpec) => ramStat(accessor, p),
    opts.flags.n === true,
    opts.flags.v === true,
    opts.index ?? undefined,
  )
}

export const RAM_MV = command({
  name: 'mv',
  resource: ResourceName.RAM,
  spec: specOf('mv'),
  fn: mvCommand,
  write: true,
})
