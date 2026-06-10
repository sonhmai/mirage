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

import type { GmailAccessor } from '../../../accessor/gmail.ts'
import type { IndexCacheStore } from '../../../cache/index/index.ts'
import { read as gmailRead } from '../../../core/gmail/read.ts'
import { resolveGlob } from '../../../core/gmail/glob.ts'
import { stat as gmailStat } from '../../../core/gmail/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { catGeneric } from '../generic/cat.ts'
import { fileReadProvision } from './provision.ts'

async function* gmailStream(
  accessor: GmailAccessor,
  p: PathSpec,
  index: IndexCacheStore | undefined,
): AsyncIterable<Uint8Array> {
  yield await gmailRead(accessor, p, index)
}

async function catCommand(
  accessor: GmailAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  return catGeneric(
    resolved,
    texts,
    opts,
    (p) => gmailStat(accessor, p, opts.index ?? undefined),
    (p) => gmailStream(accessor, p, opts.index ?? undefined),
  )
}

export const GMAIL_CAT = command({
  name: 'cat',
  resource: ResourceName.GMAIL,
  spec: specOf('cat'),
  fn: catCommand,
  provision: fileReadProvision,
})
