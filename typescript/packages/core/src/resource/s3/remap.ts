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

import type { RegisteredCommand } from '../../commands/config.ts'
import type { RegisteredOp } from '../../ops/registry.ts'
import { ResourceName } from '../../types.ts'

/**
 * Rebind S3-registered ops to an S3-compatible alias kind (gcs, r2,
 * minio, wasabi, ...) so dispatch finds them under the alias resource.
 */
export function remapOpsResource(ops: readonly RegisteredOp[], to: string): RegisteredOp[] {
  return ops.map((op) => (op.resource === ResourceName.S3 ? { ...op, resource: to } : op))
}

/**
 * Same as `remapOpsResource` but for registered commands, which are
 * class instances: copy via the prototype to keep methods intact.
 */
export function remapCommandsResource(
  commands: readonly RegisteredCommand[],
  to: string,
): RegisteredCommand[] {
  return commands.map((cmd) => {
    if (cmd.resource !== ResourceName.S3) return cmd
    const proto = Object.getPrototypeOf(cmd) as object
    const copy = Object.assign(Object.create(proto) as RegisteredCommand, cmd)
    Object.assign(copy, { resource: to })
    return copy
  })
}
