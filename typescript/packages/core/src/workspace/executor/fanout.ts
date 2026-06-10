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

import { type ByteSource, IOResult, materialize } from '../../io/types.ts'
import type { Resource } from '../../resource/base.ts'
import { PathSpec } from '../../types.ts'
import type { Mount } from '../mount/mount.ts'
import type { MountRegistry } from '../mount/registry.ts'
import { ExecutionNode } from '../types.ts'
import { resolveAcrossMounts } from '../../commands/safeguard.ts'
import { applyFindActions } from './find_action_dispatch.ts'
import { rstripSlash } from '../../util/slash.ts'

type Result = [ByteSource | null, IOResult, ExecutionNode]

const TRAVERSAL_CMDS: ReadonlySet<string> = new Set(['find', 'tree', 'du'])

function fnmatch(name: string, pattern: string): boolean {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else if ('.+^$(){}|\\'.includes(ch)) re += '\\' + ch
    else re += ch
  }
  return new RegExp('^' + re + '$').test(name)
}

function pathSegments(path: string): string[] {
  return path.split('/').filter((s) => s !== '')
}

export function shouldFanOut(
  cmdName: string,
  paths: readonly PathSpec[],
  flagKwargs: Record<string, string | boolean>,
  registry: MountRegistry,
): boolean {
  if (paths.length === 0 || paths[0] === undefined) return false
  if (registry.descendantMounts(paths[0].original).length === 0) return false
  if (TRAVERSAL_CMDS.has(cmdName)) return true
  if (cmdName === 'grep') {
    return flagKwargs.r === true || flagKwargs.R === true || flagKwargs.recursive === true
  }
  if (cmdName === 'ls') {
    return flagKwargs.R === true
  }
  return false
}

function adjustDepthFlags(
  flagKwargs: Record<string, string | boolean>,
  parentPath: string,
  mountPrefix: string,
): Record<string, string | boolean> | null {
  const parentDepth = pathSegments(parentPath).length
  const mountDepth = pathSegments(mountPrefix).length
  const delta = mountDepth - parentDepth
  const out: Record<string, string | boolean> = { ...flagKwargs }
  if ('maxdepth' in out) {
    const orig = Number(out.maxdepth)
    if (!Number.isNaN(orig)) {
      const md = orig - delta
      if (md < 0) return null
      out.maxdepth = String(md)
    }
  }
  if ('mindepth' in out) {
    const orig = Number(out.mindepth)
    if (!Number.isNaN(orig)) {
      out.mindepth = String(Math.max(0, orig - delta))
    }
  }
  return out
}

function synthesizeFindMountEntries(
  targetPath: string,
  descendants: readonly Mount[],
  flagKwargs: Record<string, string | boolean>,
): string {
  const typeFilter = flagKwargs.type
  if (typeFilter !== undefined && typeFilter !== 'd') return ''
  const parentDepth = pathSegments(targetPath).length
  const maxRaw = flagKwargs.maxdepth
  const minRaw = flagKwargs.mindepth
  const maxDepth = maxRaw !== undefined ? Number(maxRaw) : null
  const minDepth = minRaw !== undefined ? Number(minRaw) : 0
  const namePat = typeof flagKwargs.name === 'string' ? flagKwargs.name : null
  const inamePat = typeof flagKwargs.iname === 'string' ? flagKwargs.iname : null
  const out: string[] = []
  for (const m of descendants) {
    const prefixNoSlash = rstripSlash(m.prefix)
    const depth = pathSegments(prefixNoSlash).length - parentDepth
    if (depth < minDepth) continue
    if (maxDepth !== null && !Number.isNaN(maxDepth) && depth > maxDepth) continue
    const segs = prefixNoSlash.split('/').filter((s) => s !== '')
    const base = segs[segs.length - 1] ?? prefixNoSlash
    if (namePat !== null && !fnmatch(base, namePat)) continue
    if (inamePat !== null && !fnmatch(base.toLowerCase(), inamePat.toLowerCase())) continue
    out.push(prefixNoSlash)
  }
  return out.join('\n')
}

async function filterUnderPrefixes(
  stdout: ByteSource,
  descendantPrefixes: readonly string[],
): Promise<Uint8Array> {
  const data = await materialize(stdout)
  const text = new TextDecoder().decode(data)
  const outLines: string[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    let path = line
    for (const sep of ['\t', ':']) {
      const idx = path.indexOf(sep)
      if (idx >= 0) {
        path = path.slice(0, idx)
        break
      }
    }
    if (path.startsWith('/')) {
      let shadowed = false
      for (const pre of descendantPrefixes) {
        if (path === pre || path.startsWith(pre + '/')) {
          shadowed = true
          break
        }
      }
      if (shadowed) continue
    }
    outLines.push(line)
  }
  if (outLines.length === 0) return new Uint8Array()
  return new TextEncoder().encode(outLines.join('\n') + '\n')
}

export async function fanOutTraversal(
  cmdName: string,
  paths: readonly PathSpec[],
  texts: readonly string[],
  flagKwargs: Record<string, string | boolean>,
  registry: MountRegistry,
  primaryMount: Mount,
  cwd: string,
  cmdStr: string,
  stdin: ByteSource | null,
  ensureOpen: ((resource: Resource) => Promise<void>) | undefined,
): Promise<Result> {
  const targetPath = paths[0]?.original ?? cwd
  const descendants = registry.descendantMounts(targetPath)
  const descendantPrefixes = descendants.map((m) => rstripSlash(m.prefix))

  const allStdout: Uint8Array[] = []
  let mergedIo = new IOResult()
  let finalExit = 0
  let successSeen = false

  const mountsToRun: Mount[] = [primaryMount, ...descendants]
  for (const mount of mountsToRun) {
    let subPaths: PathSpec[]
    let subFlags: Record<string, string | boolean>
    if (mount === primaryMount) {
      subPaths = [...paths]
      subFlags = { ...flagKwargs }
    } else {
      const adjusted = adjustDepthFlags(flagKwargs, targetPath, mount.prefix)
      if (adjusted === null) continue
      subFlags = adjusted
      const mountRoot = rstripSlash(mount.prefix) || '/'
      subPaths = [
        new PathSpec({
          original: mountRoot,
          directory: mountRoot,
          prefix: rstripSlash(mount.prefix),
        }),
      ]
    }
    if (ensureOpen !== undefined) {
      try {
        await ensureOpen(mount.resource)
      } catch {
        continue
      }
    }
    let stdout: ByteSource | null
    let io: IOResult
    try {
      const result = await mount.executeCmd(cmdName, subPaths, [...texts], subFlags, {
        stdin,
        cwd,
      })
      stdout = result[0]
      io = result[1]
    } catch {
      continue
    }
    if (mount === primaryMount && descendantPrefixes.length > 0 && stdout !== null) {
      stdout = await filterUnderPrefixes(stdout, descendantPrefixes)
    }
    if (stdout !== null) {
      const data = await materialize(stdout)
      if (data.length > 0) allStdout.push(data)
    }
    if (io.exitCode === 0) {
      successSeen = true
    } else if (finalExit === 0) {
      finalExit = io.exitCode
    }
    mergedIo = await mergedIo.merge(io)
  }

  if (cmdName === 'find') {
    const synthetic = synthesizeFindMountEntries(targetPath, descendants, flagKwargs)
    if (synthetic !== '') allStdout.push(new TextEncoder().encode(synthetic))
  }

  let finalIoExit = successSeen ? 0 : finalExit
  let combined: ByteSource | null = null
  if (allStdout.length > 0) {
    const parts = allStdout.map((d) => {
      const s = new TextDecoder().decode(d).replace(/\n+$/, '')
      return s
    })
    combined = new TextEncoder().encode(parts.filter((s) => s !== '').join('\n') + '\n')
  }

  if (cmdName === 'find') {
    const [newCombined, actionErr] = await applyFindActions(combined, flagKwargs, registry, cwd)
    combined = newCombined
    if (actionErr.length > 0) {
      const existing = await materialize(mergedIo.stderr)
      const merged = new Uint8Array(existing.length + actionErr.length)
      merged.set(existing, 0)
      merged.set(actionErr, existing.length)
      mergedIo.stderr = merged
      if (finalIoExit === 0) finalIoExit = 1
    }
  }

  mergedIo.exitCode = finalIoExit
  mergedIo.safeguard = resolveAcrossMounts(cmdName, mountsToRun)
  const stderrBytes = await materialize(mergedIo.stderr)
  const exec = new ExecutionNode({
    command: cmdStr,
    stderr: stderrBytes,
    exitCode: finalIoExit,
  })
  return [combined, mergedIo, exec]
}
