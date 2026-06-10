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

import type { DiscordAccessor } from '../../../accessor/discord.ts'
import { resolveDiscordGlob } from '../../../core/discord/glob.ts'
import { stat as discordStat } from '../../../core/discord/stat.ts'
import { ResourceName, type PathSpec } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { realpathGeneric } from '../generic/realpath.ts'

async function realpathCommand(
  accessor: DiscordAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveDiscordGlob(accessor, paths, opts.index ?? undefined) : []
  return realpathGeneric(resolved, texts, opts, (p) =>
    discordStat(accessor, p, opts.index ?? undefined),
  )
}

export const DISCORD_REALPATH = command({
  name: 'realpath',
  resource: ResourceName.DISCORD,
  spec: specOf('realpath'),
  fn: realpathCommand,
})
