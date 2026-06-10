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
import type { FindOptions } from '../../resource/base.ts'
import { PathSpec } from '../../types.ts'
import { fnmatch } from '../../util/fnmatch.ts'
import { resolvePath } from './path.ts'
import { stat } from './stat.ts'
import { walk } from './walk.ts'

function relativeDepth(item: string, root: string): number {
  const rootNorm = root.replace(/\/+$/, '') !== '' ? root.replace(/\/+$/, '') : '/'
  const itemNorm = item.replace(/\/+$/, '') !== '' ? item.replace(/\/+$/, '') : '/'
  if (itemNorm === rootNorm) return 0
  let relative: string
  if (rootNorm === '/') {
    relative = itemNorm.replace(/^\/+|\/+$/g, '')
  } else {
    relative = itemNorm.startsWith(rootNorm) ? itemNorm.slice(rootNorm.length) : itemNorm
    relative = relative.replace(/^\/+/, '')
  }
  if (relative === '') return 0
  return relative.split('/').length
}

async function matches(
  accessor: ChromaAccessor,
  item: string,
  prefix: string,
  index: IndexCacheStore | undefined,
  root: string,
  options: FindOptions,
): Promise<boolean> {
  const itemName = item.replace(/\/+$/, '').split('/').pop() ?? ''
  if (options.minDepth != null && relativeDepth(item, root) < options.minDepth) return false
  if (options.name != null && options.name !== '' && !fnmatch(itemName, options.name)) return false
  if (
    options.iname != null &&
    options.iname !== '' &&
    !fnmatch(itemName.toLowerCase(), options.iname.toLowerCase())
  ) {
    return false
  }
  if (
    options.pathPattern != null &&
    options.pathPattern !== '' &&
    !fnmatch(item, options.pathPattern)
  ) {
    return false
  }
  if (
    options.nameExclude != null &&
    options.nameExclude !== '' &&
    fnmatch(itemName, options.nameExclude)
  ) {
    return false
  }
  if (
    options.orNames != null &&
    options.orNames.length > 0 &&
    !options.orNames.some((pattern) => fnmatch(itemName, pattern))
  ) {
    return false
  }
  const spec = PathSpec.fromStrPath(item, prefix)
  if (options.type != null) {
    const resolved = await resolvePath(accessor, spec, index)
    if (options.type === 'f' && resolved.isDir) return false
    if (options.type === 'd' && !resolved.isDir) return false
  }
  if (options.minSize != null || options.maxSize != null) {
    const itemStat = await stat(accessor, spec, index)
    if (itemStat.size === null) return false
    if (options.minSize != null && itemStat.size < options.minSize) return false
    if (options.maxSize != null && itemStat.size > options.maxSize) return false
  }
  if (options.mtimeMin != null || options.mtimeMax != null) {
    const itemStat = await stat(accessor, spec, index)
    if (itemStat.modified === null) return false
    const modTs = Date.parse(itemStat.modified) / 1000
    if (Number.isNaN(modTs)) return false
    if (options.mtimeMin != null && modTs < options.mtimeMin) return false
    if (options.mtimeMax != null && modTs > options.mtimeMax) return false
  }
  return true
}

export async function find(
  accessor: ChromaAccessor,
  path: PathSpec,
  options: FindOptions = {},
  index?: IndexCacheStore,
): Promise<string[]> {
  if (index === undefined) {
    throw new Error('find: missing index')
  }
  const results = await walk(accessor, path, index, {
    includeRoot: true,
    maxDepth: options.maxDepth ?? null,
    stripPrefix: true,
  })
  const filtered: string[] = []
  for (const item of results) {
    if (await matches(accessor, item, path.prefix, index, path.stripPrefix, options)) {
      filtered.push(item)
    }
  }
  return filtered.sort()
}
