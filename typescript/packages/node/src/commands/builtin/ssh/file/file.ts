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
  ResourceName,
  command,
  fileGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type PathSpec,
} from '@struktoai/mirage-core'
import { resolveGlob } from '../../../../core/ssh/glob.ts'
import { read as sshRead } from '../../../../core/ssh/read.ts'
import { stat as sshStat } from '../../../../core/ssh/stat.ts'
import type { SSHAccessor } from '../../../../accessor/ssh.ts'

async function fileCommand(
  accessor: SSHAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved = paths.length > 0 ? await resolveGlob(accessor, paths) : []
  return fileGeneric(
    resolved,
    opts,
    (p) => sshStat(accessor, p),
    (p) => sshRead(accessor, p),
  )
}

export const SSH_FILE = command({
  name: 'file',
  resource: ResourceName.SSH,
  spec: specOf('file'),
  fn: fileCommand,
})
