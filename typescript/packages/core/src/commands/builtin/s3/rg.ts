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
import { resolveGlob } from '../../../core/s3/glob.ts'
import { readdir as s3Readdir } from '../../../core/s3/readdir.ts'
import { stat as s3Stat } from '../../../core/s3/stat.ts'
import { stream as s3Stream } from '../../../core/s3/stream.ts'
import { type FileStat, ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { rgGeneric } from '../generic/rg.ts'
import { fileReadProvision } from './provision.ts'

async function rgCommand(
  accessor: S3Accessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  const stat = (p: PathSpec): Promise<FileStat> => s3Stat(accessor, p, opts.index ?? undefined)
  const readdir = (p: PathSpec): Promise<string[]> =>
    s3Readdir(accessor, p, opts.index ?? undefined)
  return rgGeneric(resolved, texts, opts, stat, readdir, (p) => s3Stream(accessor, p))
}

export const S3_RG = command({
  name: 'rg',
  resource: ResourceName.S3,
  spec: specOf('rg'),
  fn: rgCommand,
  provision: fileReadProvision,
})
