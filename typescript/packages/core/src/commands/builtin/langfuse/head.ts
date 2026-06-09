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

import type { LangfuseAccessor } from '../../../accessor/langfuse.ts'
import type { IndexCacheStore } from '../../../cache/index/index.ts'
import { resolveLangfuseGlob } from '../../../core/langfuse/glob.ts'
import { read as langfuseRead } from '../../../core/langfuse/read.ts'
import { stat as langfuseStat } from '../../../core/langfuse/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { headGeneric } from '../generic/head.ts'
import { fileReadProvision } from './_provision.ts'

async function* langfuseStream(
  accessor: LangfuseAccessor,
  p: PathSpec,
  index: IndexCacheStore | undefined,
): AsyncIterable<Uint8Array> {
  yield await langfuseRead(accessor, p, index)
}

async function headCommand(
  accessor: LangfuseAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveLangfuseGlob(accessor, paths, opts.index ?? undefined) : []
  return headGeneric(
    resolved,
    texts,
    opts,
    (p) => langfuseStat(accessor, p, opts.index ?? undefined),
    (p) => langfuseStream(accessor, p, opts.index ?? undefined),
  )
}

export const LANGFUSE_HEAD = command({
  name: 'head',
  resource: ResourceName.LANGFUSE,
  spec: specOf('head'),
  fn: headCommand,
  provision: fileReadProvision,
})
