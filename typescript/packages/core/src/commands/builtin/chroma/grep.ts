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

import type { ChromaAccessor } from '../../../accessor/chroma.ts'
import { resolveGlob } from '../../../core/chroma/glob.ts'
import { coarseFilterSlugs, targetSlugs } from '../../../core/chroma/grep.ts'
import { readStream } from '../../../core/chroma/read.ts'
import { readdir as chromaReaddir } from '../../../core/chroma/readdir.ts'
import { statLight } from '../../../core/chroma/stat.ts'
import { IOResult } from '../../../io/types.ts'
import { type FileStat, PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { patternArg } from '../grep_helper.ts'
import { grepGeneric } from '../generic/grep.ts'

async function grepCommand(
  accessor: ChromaAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const index = opts.index ?? undefined
  const resolved = paths.length > 0 ? await resolveGlob(accessor, paths, index) : []
  const pattern = patternArg(texts, opts.flags) ?? undefined
  let files = resolved
  let showFilename = false
  let grepOpts = opts
  if (resolved.length > 0 && pattern !== undefined) {
    // Pushdown: expand the scope to files and let ChromaDB pre-filter
    // which documents can contain the pattern, so only candidate
    // documents are fetched. The generic grep owns flag handling and
    // output formatting on the surviving files.
    const targets = await targetSlugs(accessor, resolved, index)
    const matched = new Set(
      await coarseFilterSlugs(accessor, pattern, targets, {
        ignoreCase: opts.flags.i === true,
        invert: opts.flags.v === true,
        fixedString: opts.flags.F === true,
      }),
    )
    const prefix = resolved[0]?.prefix ?? ''
    files = [...targets.entries()]
      .filter(([, slug]) => matched.has(slug))
      .map(([p]) => PathSpec.fromStrPath(p, prefix))
    if (files.length === 0) {
      return [new Uint8Array(0), new IOResult({ exitCode: 1 })]
    }
    showFilename =
      opts.flags.r === true || opts.flags.R === true || resolved.length > 1 || targets.size > 1
    // Paths are pre-expanded to files, so the generic must not recurse.
    grepOpts = { ...opts, flags: { ...opts.flags, r: false, R: false } }
  }
  const stat = (p: PathSpec): Promise<FileStat> => statLight(accessor, p, index)
  const readdir = (p: PathSpec): Promise<string[]> => chromaReaddir(accessor, p, index)
  return grepGeneric(
    'grep',
    files,
    texts,
    grepOpts,
    stat,
    readdir,
    (p) => readStream(accessor, p, index),
    undefined,
    showFilename,
  )
}

export const CHROMA_GREP = command({
  name: 'grep',
  resource: ResourceName.CHROMA,
  spec: specOf('grep'),
  fn: grepCommand,
})
