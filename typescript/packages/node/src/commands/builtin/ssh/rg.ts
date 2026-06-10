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
  rgGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type FileStat,
  type PathSpec,
} from '@struktoai/mirage-core'
import { resolveGlob } from '../../../core/ssh/glob.ts'
import { readdir as sshReaddir } from '../../../core/ssh/readdir.ts'
import { stat as sshStat } from '../../../core/ssh/stat.ts'
import { stream as sshStream } from '../../../core/ssh/stream.ts'
import type { SSHAccessor } from '../../../accessor/ssh.ts'

async function rgCommand(
  accessor: SSHAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved = paths.length > 0 ? await resolveGlob(accessor, paths) : []
  const stat = (p: PathSpec): Promise<FileStat> => sshStat(accessor, p)
  const readdir = (p: PathSpec): Promise<string[]> => sshReaddir(accessor, p)
  return rgGeneric(resolved, texts, opts, stat, readdir, (p) => sshStream(accessor, p))
}

export const SSH_RG = command({
  name: 'rg',
  resource: ResourceName.SSH,
  spec: specOf('rg'),
  fn: rgCommand,
})
