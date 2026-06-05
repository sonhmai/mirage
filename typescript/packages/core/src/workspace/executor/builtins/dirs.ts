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

import { resolvePath } from '../../../commands/spec/parser.ts'
import { IOResult } from '../../../io/types.ts'
import type { PathSpec } from '../../../types.ts'
import { FileType } from '../../../types.ts'
import type { Session } from '../../session/session.ts'
import { ExecutionNode } from '../../types.ts'
import type { DispatchFn } from '../cross_mount.ts'
import { toScope, scopePath } from './scope.ts'
import type { Result } from './scope.ts'

export async function handleCd(
  dispatch: DispatchFn,
  isMountRoot: (path: string) => boolean,
  path: string | PathSpec,
  session: Session,
): Promise<Result> {
  const raw = scopePath(path)
  const resolved = resolvePath(session.cwd, raw)
  if (resolved === '/') {
    session.cwd = '/'
    return [null, new IOResult(), new ExecutionNode({ command: `cd ${raw}`, exitCode: 0 })]
  }
  const scope = toScope(resolved)
  let stat: { type?: string } | null = null
  let notFound = false
  try {
    const [s] = await dispatch('stat', scope)
    stat = s as { type?: string } | null
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc)
    if (/not found|no such file/i.test(msg)) {
      notFound = true
    } else {
      const err = new TextEncoder().encode(`cd: ${raw}: ${msg}\n`)
      return [
        null,
        new IOResult({ exitCode: 1, stderr: err }),
        new ExecutionNode({ command: `cd ${raw}`, exitCode: 1, stderr: err }),
      ]
    }
  }
  if (stat === null || notFound) {
    if (!isMountRoot(resolved)) {
      const err = new TextEncoder().encode(`cd: ${raw}: No such file or directory\n`)
      return [
        null,
        new IOResult({ exitCode: 1, stderr: err }),
        new ExecutionNode({ command: `cd ${raw}`, exitCode: 1, stderr: err }),
      ]
    }
  } else if (stat.type !== FileType.DIRECTORY) {
    const err = new TextEncoder().encode(`cd: ${raw}: Not a directory\n`)
    return [
      null,
      new IOResult({ exitCode: 1, stderr: err }),
      new ExecutionNode({ command: `cd ${raw}`, exitCode: 1, stderr: err }),
    ]
  }
  session.cwd = resolved
  return [null, new IOResult(), new ExecutionNode({ command: `cd ${raw}`, exitCode: 0 })]
}
