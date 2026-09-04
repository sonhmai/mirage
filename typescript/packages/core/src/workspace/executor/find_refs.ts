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

import type { StatPath } from '../../ops/types.ts'
import { isoTimestamp } from '../../utils/dates.ts'
import { classifyBarePath } from '../expand/classify/index.ts'
import type { MountRegistry } from '../mount/registry.ts'
import type { Namespace } from '../mount/namespace/namespace.ts'
import { mergeOverlayStat } from '../mount/namespace/overlay.ts'

export const NEWER = '-newer'
export const NEWERMT = '-newermt'

/** GNU's line for a `-newer` reference that does not exist. */
export function missingReferenceLine(ref: string): Uint8Array {
  return new TextEncoder().encode(`find: '${ref}': No such file or directory\n`)
}

/**
 * Rewrite every `-newer FILE` in an expression into `-newermt`.
 *
 * A backend's find op sees the expression as tokens and can stat nothing
 * outside its own mount, while the reference may live on any mount and
 * carry a namespace-overlay mtime (a `touch -d` on a backend that stores
 * none). So the executor resolves each reference through the dispatcher
 * once, before any backend parses the expression, and hands down a
 * timestamp that needs no further I/O. A reference that does not exist is
 * GNU's error, exit 1, and no walk runs. Returns the rewritten tokens and
 * null, or the tokens untouched and the error line for the first
 * reference that does not exist.
 */
export async function resolveNewerRefs(
  tokens: readonly string[],
  refs: readonly string[],
  registry: MountRegistry,
  cwd: string,
  statPath: StatPath,
  namespace: Namespace | null = null,
): Promise<[string[], Uint8Array | null]> {
  const times: string[] = []
  for (const ref of refs) {
    const scope = classifyBarePath(ref, registry, cwd)
    const virtual = typeof scope === 'string' ? ref : scope.virtual
    let stat = await statPath(virtual)
    if (stat === null) return [[...tokens], missingReferenceLine(ref)]
    if (namespace !== null) stat = mergeOverlayStat(namespace.metaFor(virtual), stat)
    // A reference with no reported mtime is never "older" than anything:
    // the epoch bound admits every dated entry, which is the most a
    // backend without times can honestly say.
    const ts = isoTimestamp(stat.modified) ?? 0
    times.push(new Date(ts * 1000).toISOString())
  }
  const rewritten: string[] = []
  let i = 0
  let n = 0
  while (i < tokens.length) {
    if (tokens[i] === NEWER && i + 1 < tokens.length && n < times.length) {
      rewritten.push(NEWERMT, times[n] ?? '')
      n += 1
      i += 2
      continue
    }
    rewritten.push(tokens[i] ?? '')
    i += 1
  }
  return [rewritten, null]
}
