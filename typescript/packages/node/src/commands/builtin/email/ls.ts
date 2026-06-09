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
  PathSpec,
  ResourceName,
  command,
  lsGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
} from '@struktoai/mirage-core'
import type { EmailAccessor } from '../../../accessor/email.ts'
import { resolveGlob } from '../../../core/email/glob.ts'
import { readdir as emailReaddir } from '../../../core/email/readdir.ts'
import { stat as emailStat } from '../../../core/email/stat.ts'
import { metadataProvision } from './provision.ts'

async function lsCommand(
  accessor: EmailAccessor,
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
    (p) => emailReaddir(accessor, p, opts.index ?? undefined),
    (p) => emailStat(accessor, p, opts.index ?? undefined),
  )
}

export const EMAIL_LS = command({
  name: 'ls',
  resource: ResourceName.EMAIL,
  spec: specOf('ls'),
  fn: lsCommand,
  provision: metadataProvision,
})
