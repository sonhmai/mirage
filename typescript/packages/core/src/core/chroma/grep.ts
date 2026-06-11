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

import type { ChromaAccessor } from '../../accessor/chroma.ts'
import type { IndexCacheStore } from '../../cache/index/store.ts'
import { PathSpec } from '../../types.ts'
import { queryContains } from './_client.ts'
import { resolvePath } from './path.ts'
import { walk } from './walk.ts'

export async function coarseFilterSlugs(
  accessor: ChromaAccessor,
  pattern: string,
  targets: ReadonlyMap<string, string>,
  options: { ignoreCase: boolean; invert: boolean; fixedString: boolean },
): Promise<string[]> {
  const candidateSlugs = [...targets.values()].sort()
  if (options.ignoreCase || options.invert) {
    return candidateSlugs
  }
  return queryContains(accessor, pattern, candidateSlugs, !options.fixedString)
}

export async function targetSlugs(
  accessor: ChromaAccessor,
  paths: readonly PathSpec[],
  index?: IndexCacheStore,
): Promise<Map<string, string>> {
  const targets = new Map<string, string>()
  for (const path of paths) {
    const resolved = await resolvePath(accessor, path, index)
    if (resolved.entry !== null && !resolved.isDir) {
      targets.set(path.original, String(resolved.entry.extra.slug))
      continue
    }
    if (resolved.isDir) {
      const children = await walk(accessor, path, index, {
        includeRoot: false,
        stripPrefix: false,
      })
      for (const child of children) {
        const childSpec = PathSpec.fromStrPath(child, path.prefix)
        const childResolved = await resolvePath(accessor, childSpec, index)
        if (childResolved.entry !== null && !childResolved.isDir) {
          targets.set(child, String(childResolved.entry.extra.slug))
        }
      }
    }
  }
  return targets
}
