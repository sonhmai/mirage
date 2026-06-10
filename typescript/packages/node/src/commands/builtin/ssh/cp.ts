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
  IOResult,
  ResourceName,
  command,
  cpGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type FindOptions,
  type PathSpec,
} from '@struktoai/mirage-core'
import { copy as coreCopy } from '../../../core/ssh/copy.ts'
import { find as coreFind } from '../../../core/ssh/find.ts'
import { stat as coreStat } from '../../../core/ssh/stat.ts'
import type { SSHAccessor } from '../../../accessor/ssh.ts'

function cpCommand(
  accessor: SSHAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  if (paths.length < 2) {
    return Promise.resolve([
      null,
      new IOResult({ exitCode: 1, stderr: new TextEncoder().encode('cp: missing operand\n') }),
    ])
  }
  const recursive = opts.flags.r === true || opts.flags.R === true || opts.flags.a === true
  return cpGeneric(
    paths,
    (src: PathSpec, target: PathSpec) => coreCopy(accessor, src, target),
    (src: PathSpec, options: FindOptions) => coreFind(accessor, src, options),
    (p: PathSpec) => coreStat(accessor, p),
    recursive,
    opts.flags.n === true,
    opts.flags.v === true,
    opts.index ?? undefined,
  )
}

export const SSH_CP = command({
  name: 'cp',
  resource: ResourceName.SSH,
  spec: specOf('cp'),
  fn: cpCommand,
  write: true,
})
