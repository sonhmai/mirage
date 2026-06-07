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

import type { GitHubCIAccessor } from '../../../accessor/github_ci.ts'
import { resolveGlob } from '../../../core/github_ci/glob.ts'
import { stream as ciStream } from '../../../core/github_ci/read.ts'
import { stat as ciStat } from '../../../core/github_ci/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { headGeneric } from '../generic/head.ts'
import { fileReadProvision } from './provision.ts'

async function headCommand(
  accessor: GitHubCIAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  return headGeneric(
    resolved,
    texts,
    opts,
    (p) => ciStat(accessor, p, opts.index ?? undefined),
    (p) => ciStream(accessor, p, opts.index ?? undefined),
  )
}

export const GITHUB_CI_HEAD = command({
  name: 'head',
  resource: ResourceName.GITHUB_CI,
  spec: specOf('head'),
  fn: headCommand,
  provision: fileReadProvision,
})
