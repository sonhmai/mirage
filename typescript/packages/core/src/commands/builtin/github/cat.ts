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

import type { GitHubAccessor } from '../../../accessor/github.ts'
import { stream as githubStream } from '../../../core/github/read.ts'
import { resolveGlob } from '../../../core/github/glob.ts'
import { stat as githubStat } from '../../../core/github/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { catGeneric } from '../generic/cat.ts'
import { fileReadProvision } from './provision.ts'

async function catCommand(
  accessor: GitHubAccessor,
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
    (p) => githubStat(accessor, p, opts.index ?? undefined),
    (p) => githubStream(accessor, p, opts.index ?? undefined),
  )
}

export const GITHUB_CAT = command({
  name: 'cat',
  resource: ResourceName.GITHUB,
  spec: specOf('cat'),
  fn: catCommand,
  provision: fileReadProvision,
})
