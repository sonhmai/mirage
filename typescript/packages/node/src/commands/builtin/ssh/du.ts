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
  duGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type PathSpec,
} from '@struktoai/mirage-core'
import { du as sshDu, duAll as sshDuAll } from '../../../core/ssh/du.ts'
import { resolveGlob } from '../../../core/ssh/glob.ts'
import type { SSHAccessor } from '../../../accessor/ssh.ts'

async function duCommand(
  accessor: SSHAccessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved = paths.length > 0 ? await resolveGlob(accessor, paths) : []
  return duGeneric(
    resolved,
    opts,
    (p) => sshDu(accessor, p),
    (p) => sshDuAll(accessor, p),
  )
}

export const SSH_DU = command({
  name: 'du',
  resource: ResourceName.SSH,
  spec: specOf('du'),
  fn: duCommand,
})
