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
  jqGeneric,
  specOf,
  type CommandFnResult,
  type CommandOpts,
  type IndexCacheStore,
  type PathSpec,
} from '@struktoai/mirage-core'
import type { EmailAccessor } from '../../../accessor/email.ts'
import { resolveGlob } from '../../../core/email/glob.ts'
import { read as emailRead } from '../../../core/email/read.ts'

async function* emailStream(
  accessor: EmailAccessor,
  p: PathSpec,
  index: IndexCacheStore | undefined,
): AsyncIterable<Uint8Array> {
  yield await emailRead(accessor, p, index)
}

async function jqCommand(
  accessor: EmailAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
  const stream = (p: PathSpec): AsyncIterable<Uint8Array> =>
    emailStream(accessor, p, opts.index ?? undefined)
  return jqGeneric(resolved, texts, opts, stream)
}

export const EMAIL_JQ = command({
  name: 'jq',
  resource: ResourceName.EMAIL,
  spec: specOf('jq'),
  fn: jqCommand,
})
