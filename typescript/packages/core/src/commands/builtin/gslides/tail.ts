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

import type { GSlidesAccessor } from '../../../accessor/gslides.ts'
import { stream as gslidesStream } from '../../../core/gslides/read.ts'
import { resolveGlob } from '../../../core/gslides/glob.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { tailGeneric } from '../generic/tail.ts'
import { fileReadProvision } from './provision.ts'

async function tailCommand(
  accessor: GSlidesAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  return tailGeneric(resolved, texts, opts, (p) =>
    gslidesStream(accessor, p, opts.index ?? undefined),
  )
}

export const GSLIDES_TAIL = command({
  name: 'tail',
  resource: ResourceName.GSLIDES,
  spec: specOf('tail'),
  fn: tailCommand,
  provision: fileReadProvision,
})
