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

import type { IndexCacheStore } from '../../cache/index/store.ts'
import type { FindOptions } from '../../resource/base.ts'
import { type FileStat, FileType, PathSpec } from '../../types.ts'
import type { NotionStatAccessor } from './stat.ts'
import { readdir } from './readdir.ts'
import { stat } from './stat.ts'

function fnmatch(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*')
  return new RegExp(`^${re}$`).test(name)
}

async function collect(
  accessor: NotionStatAccessor,
  path: PathSpec,
  index: IndexCacheStore | undefined,
  out: [string, FileStat][],
): Promise<void> {
  const fileStat = await stat(accessor, path, index)
  out.push([path.original, fileStat])
  if (fileStat.type !== FileType.DIRECTORY) return
  for (const entry of await readdir(accessor, path, index)) {
    const child = new PathSpec({
      original: entry,
      directory: entry,
      resolved: false,
      prefix: path.prefix,
    })
    await collect(accessor, child, index, out)
  }
}

export async function find(
  accessor: NotionStatAccessor,
  path: PathSpec,
  options: FindOptions = {},
  index?: IndexCacheStore,
): Promise<string[]> {
  const stripped = path.stripPrefix.replace(/^\/+|\/+$/g, '')
  const base = stripped !== '' ? `/${stripped}` : '/'
  const baseDepth = base === '/' ? 0 : (base.match(/\//g) ?? []).length
  const collected: [string, FileStat][] = []
  await collect(accessor, path, index, collected)
  const results: string[] = []
  for (const [entryPath, fileStat] of collected) {
    let rel = entryPath
    if (path.prefix !== '' && rel.startsWith(path.prefix)) {
      rel = rel.slice(path.prefix.length) || '/'
    }
    const relStripped = rel.replace(/^\/+|\/+$/g, '')
    rel = relStripped !== '' ? `/${relStripped}` : '/'
    const isDir = fileStat.type === FileType.DIRECTORY
    if (options.type === 'f' && isDir) continue
    if (options.type === 'd' && !isDir) continue
    const entryName = rel.split('/').pop() ?? rel
    const orNames = options.orNames ?? null
    if (orNames !== null && orNames.length > 0) {
      if (!orNames.some((pat) => fnmatch(entryName, pat))) continue
    } else if (options.name !== undefined && options.name !== null) {
      if (!fnmatch(entryName, options.name)) continue
    }
    if (options.iname !== undefined && options.iname !== null) {
      if (!fnmatch(entryName.toLowerCase(), options.iname.toLowerCase())) continue
    }
    if (options.pathPattern !== undefined && options.pathPattern !== null) {
      if (!fnmatch(rel, options.pathPattern)) continue
    }
    if (options.nameExclude !== undefined && options.nameExclude !== null) {
      if (fnmatch(entryName, options.nameExclude)) continue
    }
    const depth = rel === base ? 0 : (rel.match(/\//g) ?? []).length - baseDepth
    if (options.maxDepth !== undefined && options.maxDepth !== null && depth > options.maxDepth) {
      continue
    }
    if (options.minDepth !== undefined && options.minDepth !== null && depth < options.minDepth) {
      continue
    }
    if (!isDir && (options.minSize != null || options.maxSize != null)) {
      const size = fileStat.size ?? 0
      if (options.minSize != null && size < options.minSize) continue
      if (options.maxSize != null && size > options.maxSize) continue
    }
    results.push(rel)
  }
  return results.sort()
}
