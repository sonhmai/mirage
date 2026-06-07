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

import type { FindOptions } from '../../../resource/base.ts'
import { FileType, PathSpec, type FileStat } from '../../../types.ts'

type Readdir = (p: PathSpec) => Promise<string[]>
type Stat = (p: PathSpec) => Promise<FileStat>
type Find = (root: PathSpec, options: FindOptions) => Promise<string[]>

function childSpec(entryPath: string, prefix: string): PathSpec {
  return new PathSpec({ original: entryPath, directory: entryPath, resolved: false, prefix })
}

async function walkFiles(
  readdir: Readdir,
  stat: Stat,
  dir: PathSpec,
  out: string[],
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const entryPath of entries) {
    const child = childSpec(entryPath, dir.prefix)
    let s: FileStat
    try {
      s = await stat(child)
    } catch {
      continue
    }
    if (s.type === FileType.DIRECTORY) await walkFiles(readdir, stat, child, out)
    else out.push(entryPath)
  }
}

export function findFromReaddir(readdir: Readdir, stat: Stat): Find {
  return async (root, options) => {
    if (options.type === 'f') {
      const out: string[] = []
      await walkFiles(readdir, stat, root, out)
      return out
    }
    try {
      return await readdir(root)
    } catch {
      return []
    }
  }
}
