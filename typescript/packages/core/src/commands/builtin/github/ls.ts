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
import { resolveGlob } from '../../../core/github/glob.ts'
import { readdir as githubReaddir } from '../../../core/github/readdir.ts'
import { stat as githubStat } from '../../../core/github/stat.ts'
import { PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { lsGeneric } from '../generic/ls.ts'
import { metadataProvision } from './provision.ts'

async function lsCommand(
  accessor: GitHubAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  let workingPaths: PathSpec[] = paths
  if (workingPaths.length === 0) {
    workingPaths = [
      new PathSpec({
        original: opts.cwd,
        directory: opts.cwd,
        resolved: false,
        prefix: opts.mountPrefix ?? '',
      }),
    ]
  }
  const resolved = await resolveGlob(accessor, workingPaths, opts.index ?? undefined)
  return lsGeneric(
    resolved,
    opts,
    (p) => githubReaddir(accessor, p, opts.index ?? undefined),
    (p) => githubStat(accessor, p, opts.index ?? undefined),
  )
}

export const GITHUB_LS = command({
  name: 'ls',
  resource: ResourceName.GITHUB,
  spec: specOf('ls'),
  fn: lsCommand,
  provision: metadataProvision,
})
