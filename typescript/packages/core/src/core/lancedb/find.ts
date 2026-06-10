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

import type { LanceDBAccessor } from '../../accessor/lancedb.ts'
import type { FindOptions } from '../../resource/base.ts'
import { PathSpec } from '../../types.ts'
import { readdir } from './readdir.ts'

function fnmatch(name: string, pattern: string): boolean {
  let regex = '^'
  for (const c of pattern) {
    if (c === '*') regex += '.*'
    else if (c === '?') regex += '.'
    else if ('.+()|[]{}\\^$'.includes(c)) regex += '\\' + c
    else regex += c
  }
  regex += '$'
  return new RegExp(regex).test(name)
}

function isRowFile(name: string, config: LanceDBAccessor['config']): boolean {
  if (name.endsWith('.md')) return true
  if (config.blobColumn !== null && name.endsWith(`.${config.blobExt}`)) return true
  return false
}

async function walk(
  accessor: LanceDBAccessor,
  spec: PathSpec,
  maxDepth: number | null,
  depth: number,
  out: { path: string; depth: number; file: boolean }[],
): Promise<void> {
  if (maxDepth !== null && depth > maxDepth) return
  let children: string[]
  try {
    children = await readdir(accessor, spec)
  } catch {
    return
  }
  for (const child of children) {
    const name = child.split('/').pop() ?? ''
    const file = isRowFile(name, accessor.config)
    out.push({ path: child, depth, file })
    if (file) continue
    const childSpec = new PathSpec({
      original: child,
      directory: child,
      resolved: false,
      prefix: spec.prefix,
    })
    await walk(accessor, childSpec, maxDepth, depth + 1, out)
  }
}

export async function find(
  accessor: LanceDBAccessor,
  path: PathSpec,
  options: FindOptions = {},
): Promise<string[]> {
  const collected: { path: string; depth: number; file: boolean }[] = []
  await walk(accessor, path, options.maxDepth ?? null, 1, collected)
  const results: string[] = []
  for (const entry of collected.sort((a, b) => a.path.localeCompare(b.path))) {
    const name = entry.path.split('/').pop() ?? ''
    if (options.minDepth != null && entry.depth < options.minDepth) continue
    if (options.type === 'f' && !entry.file) continue
    if (options.type === 'd' && entry.file) continue
    if (options.orNames != null && options.orNames.length > 0) {
      if (!options.orNames.some((pat) => fnmatch(name, pat))) continue
    } else if (options.name != null && !fnmatch(name, options.name)) {
      continue
    }
    if (options.iname != null && !fnmatch(name.toLowerCase(), options.iname.toLowerCase())) {
      continue
    }
    results.push(entry.path)
  }
  return results
}
