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

import { FileType, type FileStat, type PathSpec } from '../../../types.ts'

export const SCOPE_SUGGEST = 1000
export const SCOPE_ERROR = 10000

type Readdir = (path: string) => Promise<string[]>
type Stat = (path: string) => Promise<FileStat>

async function countScope(
  readdir: Readdir,
  stat: Stat,
  path: string,
  recursive: boolean,
  count: number,
): Promise<number> {
  const entries = await readdir(path)
  let total = count
  for (const entry of entries) {
    const fileStat = await stat(entry)
    if (fileStat.type === FileType.DIRECTORY) {
      if (recursive) total = await countScope(readdir, stat, entry, true, total)
    } else {
      total += 1
    }
    if (total > SCOPE_ERROR) return total
  }
  return total
}

export async function scopeWarning(
  readdir: Readdir,
  stat: Stat,
  scope: PathSpec,
  recursive = false,
): Promise<string | null> {
  const total = await countScope(readdir, stat, scope.directory, recursive, 0)
  if (total > SCOPE_ERROR) {
    throw new Error(`scope too large: ${String(total)} files under ${scope.directory}`)
  }
  if (total > SCOPE_SUGGEST) {
    return `scanning ${String(total)} files under ${scope.directory}`
  }
  return null
}
