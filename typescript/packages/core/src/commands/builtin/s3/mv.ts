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

import type { S3Accessor } from '../../../accessor/s3.ts'
import type { IndexCacheStore } from '../../../cache/index/store.ts'
import { resolveGlob } from '../../../core/s3/glob.ts'
import { rename as s3Rename } from '../../../core/s3/rename.ts'
import { stat as s3Stat } from '../../../core/s3/stat.ts'
import { IOResult } from '../../../io/types.ts'
import { type PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { mvGeneric } from '../generic/mv.ts'

const ENC = new TextEncoder()

async function mvCommand(
  accessor: S3Accessor,
  paths: PathSpec[],
  _texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  if (paths.length < 2) {
    return [null, new IOResult({ exitCode: 1, stderr: ENC.encode('mv: requires src and dst\n') })]
  }
  const resolved = await resolveGlob(accessor, paths, opts.index ?? undefined)
  return mvGeneric(
    resolved,
    (src: PathSpec, target: PathSpec) => s3Rename(accessor, src, target),
    (p: PathSpec, idx?: IndexCacheStore) => s3Stat(accessor, p, idx),
    opts.flags.n === true,
    opts.flags.v === true,
    opts.index ?? undefined,
  )
}

export const S3_MV = command({
  name: 'mv',
  resource: ResourceName.S3,
  spec: specOf('mv'),
  fn: mvCommand,
  write: true,
})
