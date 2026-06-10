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

import { NOOPAccessor } from '../accessor/base.ts'
import { applyIo } from '../cache/file/io.ts'
import type { FileCache } from '../cache/file/mixin.ts'
import { IOResult } from '../io/types.ts'
import { runWithRevisions } from '../observe/context.ts'
import type { OpsRegistry } from '../ops/registry.ts'
import { type OpKwargs } from '../ops/registry.ts'
import type { Resource } from '../resource/base.ts'
import { MountMode, type PathSpec } from '../types.ts'
import type { DispatchFn } from './executor/cross_mount.ts'
import type { MountRegistry } from './mount/registry.ts'

const NOOP_ACCESSOR_INSTANCE = new NOOPAccessor()
const DISPATCH_READ_OPS = new Set(['read', 'read_bytes'])
const DISPATCH_WRITE_OPS = new Set([
  'write',
  'write_bytes',
  'append',
  'unlink',
  'create',
  'truncate',
])

export type ResolveFn = (path: string) => Promise<[Resource, PathSpec, MountMode]>

export class Dispatcher {
  private readonly registry: MountRegistry
  private readonly cache: FileCache & Resource
  private readonly opsRegistry: OpsRegistry
  private readonly resolveFn: ResolveFn

  constructor(
    registry: MountRegistry,
    cache: FileCache & Resource,
    opsRegistry: OpsRegistry,
    resolveFn: ResolveFn,
  ) {
    this.registry = registry
    this.cache = cache
    this.opsRegistry = opsRegistry
    this.resolveFn = resolveFn
  }

  dispatch: DispatchFn = async (opName, path, args, kwargs) => {
    const [resource, scope, mode] = await this.resolveFn(path.original)
    const cacheable = resource.isRemote === true
    if (cacheable && DISPATCH_READ_OPS.has(opName)) {
      const cached = await this.cache.get(path.original)
      if (cached !== null) {
        return [cached, new IOResult({ reads: { [path.original]: cached } })]
      }
    }
    if (mode === MountMode.READ && this.opsRegistry.find(opName, resource.kind)?.write === true) {
      throw new Error(`mount at '${path.original}' is read-only`)
    }
    const fullKwargs: OpKwargs =
      kwargs?.index === undefined && resource.index !== undefined
        ? { ...(kwargs ?? {}), index: resource.index }
        : (kwargs ?? {})
    const mount = this.registry.mountFor(path.original)
    const result = await runWithRevisions(
      mount !== null && mount.revisions.size > 0 ? mount.revisions : null,
      async () =>
        this.opsRegistry.call(
          opName,
          resource.kind,
          resource.accessor ?? NOOP_ACCESSOR_INSTANCE,
          scope,
          args ?? [],
          fullKwargs,
        ),
    )
    if (DISPATCH_WRITE_OPS.has(opName)) {
      await this.invalidateAfterWriteByPath(path.original)
    }
    return [result, new IOResult()]
  }

  async invalidateAfterWriteByPath(path: string): Promise<void> {
    const mount = this.registry.mountFor(path)
    if (mount === null) return
    if (mount.resource.isRemote === true) {
      await this.cache.remove(path)
    }
    const idx = mount.resource.index
    if (idx !== undefined) {
      const slash = path.lastIndexOf('/')
      const parent = slash <= 0 ? '/' : path.slice(0, slash)
      await idx.invalidateDir(parent)
      await idx.invalidateDir(parent + '/')
    }
  }

  async applyIo(io: IOResult): Promise<void> {
    await applyIo(this.cache, io)
    if (Object.keys(io.writes).length > 0) {
      await this.invalidateIndexDirs(io)
    }
  }

  async invalidateIndexDirs(io: IOResult): Promise<void> {
    const dirsSeen = new Set<string>()
    for (const path of Object.keys(io.writes)) {
      const mount = this.registry.mountFor(path)
      if (mount === null) continue
      const slash = path.lastIndexOf('/')
      const parent = slash <= 0 ? '/' : path.slice(0, slash)
      if (dirsSeen.has(parent)) continue
      dirsSeen.add(parent)
      const idx = mount.resource.index
      if (idx !== undefined) {
        await idx.invalidateDir(parent)
        await idx.invalidateDir(parent + '/')
      }
    }
  }
}
