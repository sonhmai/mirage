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

import type { NotionAccessor } from '../../../accessor/notion.ts'
import type { IndexCacheStore } from '../../../cache/index/store.ts'
import { resolveNotionGlob } from '../../../core/notion/glob.ts'
import { read as notionRead } from '../../../core/notion/read.ts'
import { stat as notionStat } from '../../../core/notion/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { headGeneric } from '../generic/head.ts'
import { fileReadProvision } from './_provision.ts'

async function* notionStream(
  accessor: NotionAccessor,
  p: PathSpec,
  index?: IndexCacheStore,
): AsyncIterable<Uint8Array> {
  yield await notionRead(accessor, p, index)
}

async function headCommand(
  accessor: NotionAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveNotionGlob(accessor, paths, opts.index ?? undefined) : []
  return headGeneric(
    resolved,
    texts,
    opts,
    (p) => notionStat(accessor, p, opts.index ?? undefined),
    (p) => notionStream(accessor, p, opts.index ?? undefined),
  )
}

export const NOTION_HEAD = command({
  name: 'head',
  resource: ResourceName.NOTION,
  spec: specOf('head'),
  fn: headCommand,
  provision: fileReadProvision,
})
