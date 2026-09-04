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

import { stripSlash } from '../../utils/slash.ts'
import { resolvePath } from '../../utils/path.ts'
import { shellJoin } from '../../shell/join.ts'
import { type ByteSource, materialize } from '../../io/types.ts'
import { getCurrentSession, runWithSuspendedOpPolicies } from '../../context/session_context.ts'
import { preOpsGate } from '../../policy/policies.ts'
import { PathSpec } from '../../types.ts'
import type { MountRegistry } from '../mount/registry.ts'
import { lookup } from '../lookup/lookup.ts'
import { Consumer } from '../lookup/types.ts'
import type { ChildMounts, StatPath } from '../../ops/types.ts'
import {
  EXEC_PLACEHOLDER,
  execActions,
  type ExecAction,
  type FindExpr,
  parseFindExpression,
} from '../../commands/builtin/find_parse.ts'
import type { ExecuteFn } from '../expand/node.ts'

export interface FindActionDoors {
  // Runs an `-exec` line in the session; absent outside a workspace,
  // where `-exec` is refused.
  executeFn?: ExecuteFn
  sessionId?: string
  childMounts?: ChildMounts | null
  statPath?: StatPath | null
}

const enc = new TextEncoder()

/** The scope a printed row names: rows are respelled as the operand was
 * typed, so a relative one resolves against the cwd. */
function rowScope(path: string, cwd: string): PathSpec {
  const virtual = resolvePath(path, cwd)
  const slash = virtual.lastIndexOf('/')
  return new PathSpec({
    resourcePath: stripSlash(virtual),
    virtual,
    directory: slash >= 0 ? virtual.slice(0, slash + 1) : '/',
    resolved: true,
  })
}

/**
 * The shell line one `-exec` run becomes. GNU execs the words directly, so
 * every match must reach the command as exactly one argv word: the line is
 * built with `shellJoin`, and a plain join would be re-parsed by the shell.
 * A per-match run substitutes every `{}` inside every word (`x{}y` is
 * `xd/a.txty`); a batched run replaces its one bare `{}` with the matches,
 * one word each.
 */
export function execLine(action: ExecAction, paths: readonly string[]): string {
  const words: string[] = []
  for (const word of action.argv) {
    if (action.batch && word === EXEC_PLACEHOLDER) words.push(...paths)
    else if (!action.batch) words.push(word.replaceAll(EXEC_PLACEHOLDER, paths[0] ?? ''))
    else words.push(word)
  }
  return shellJoin(words)
}

/**
 * Run one `-exec` invocation, collecting its streams. A command that
 * cannot be found is GNU's `find: 'cmd': No such file or directory` rather
 * than the shell's `command not found`, and counts as a failed run. That
 * is decided by looking the head word up before the line runs (GNU fails
 * in `execvp`), never from the exit status: a program that exists and
 * exits 127 keeps its own stderr and is just a failed run. Returns
 * whether the run succeeded, which is the action's truth value.
 */
async function runExec(
  executeFn: ExecuteFn,
  sessionId: string,
  registry: MountRegistry,
  action: ExecAction,
  paths: readonly string[],
  out: Uint8Array[],
  errors: Uint8Array[],
): Promise<boolean> {
  const head = action.argv[0] ?? ''
  const sess = getCurrentSession()
  if (sess !== null && lookup(head, sess, registry) === Consumer.UNKNOWN) {
    errors.push(enc.encode(`find: '${head}': No such file or directory\n`))
    return false
  }
  const io = await executeFn(`( ${execLine(action, paths)} )`, { sessionId })
  if (io.stdout !== null) {
    const data = await materialize(io.stdout)
    if (data.byteLength > 0) out.push(data)
  }
  const err = await materialize(io.stderr)
  if (err.byteLength > 0) errors.push(err)
  return io.exitCode === 0
}

/** Delete one accepted row; returns whether it succeeded. */
async function deleteRow(
  path: string,
  registry: MountRegistry,
  cwd: string,
  errors: Uint8Array[],
): Promise<boolean> {
  const ps = rowScope(path, cwd)
  const mount = registry.tryMountFor(ps.virtual)
  if (mount === null) {
    errors.push(enc.encode(`find: cannot delete '${path}': no mount\n`))
    return false
  }
  try {
    // -delete is find's own action, not an `rm` line, so no command rule
    // sees it; it is a removal all the same, so it clears the op door a
    // path rule guards (the same gate `ws.fs`, FUSE and a redirect
    // clear), by the session the line runs under, and a refusal reports
    // in find's voice. The delegated rm's own slots are suspended for the
    // call, so the deletion admits exactly once. -d so directories
    // emptied by the deepest-first pass are removable, matching GNU
    // -delete's rmdir behavior.
    await preOpsGate(
      registry.policies,
      'unlink',
      ps,
      true,
      mount.prefix,
      getCurrentSession()?.sessionId ?? '',
    )
    const [, rmIo] = await runWithSuspendedOpPolicies(() =>
      mount.executeCmd('rm', [ps], [], { d: true }, { stdin: null, cwd }),
    )
    if (rmIo.exitCode !== 0) {
      const errBytes = await materialize(rmIo.stderr)
      errors.push(errBytes.length > 0 ? errBytes : enc.encode(`find: cannot delete '${path}'\n`))
      return false
    }
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(enc.encode(`find: cannot delete '${path}': ${msg}\n`))
    return false
  }
}

async function lsRow(
  path: string,
  registry: MountRegistry,
  cwd: string,
  childMounts: ChildMounts | null,
  statPath: StatPath | null,
  errors: Uint8Array[],
): Promise<Uint8Array | null> {
  const ps = rowScope(path, cwd)
  const mount = registry.tryMountFor(ps.virtual)
  if (mount === null) {
    errors.push(enc.encode(`find: cannot ls '${path}': no mount\n`))
    return null
  }
  try {
    const [lsOut] = await mount.executeCmd(
      'ls',
      [ps],
      [],
      { args_l: true, d: true },
      {
        stdin: null,
        cwd,
        ...(childMounts !== null ? { ns: { childMounts } } : {}),
        ...(statPath !== null ? { statPath } : {}),
      },
    )
    if (lsOut === null) return null
    const line = new TextDecoder().decode(await materialize(lsOut)).replace(/\n+$/, '')
    return line === '' ? null : enc.encode(`${line}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(enc.encode(`find: cannot ls '${path}': ${msg}\n`))
    return null
  }
}

function hasActions(expr: FindExpr): boolean {
  return expr.actions.some((a) => a.kind !== 'print')
}

/**
 * Apply find's actions (-exec / -delete / -print0 / -ls) to its rows.
 *
 * Per-resource find handlers only emit matched paths. This dispatcher
 * layer re-reads the actions off the expression and applies them per
 * match, in the order they were written, the way GNU's implicit `-a`
 * chain runs: each per-match `-exec` runs in turn and the first that
 * fails ends the chain for that match, so a later `-print` (or `-ls`,
 * `-print0`, `-delete`) sees only the matches every earlier `-exec`
 * accepted (`-exec grep -q x {} ";" -print`), and `-exec echo {} ";"
 * -print -exec echo again {} ";"` alternates the three per match. A
 * batched `-exec ... {} +` collects the match at its position and runs
 * once after the walk; a failing batch is find's exit 1, as is a row it
 * could not delete or list; a failing per-match run is not, and neither
 * is a command that cannot be found, which GNU reports per match and
 * carries on from with exit 0. An action other than `-print` suppresses
 * the implicit print, and `-delete` is applied after the walk, deepest
 * first, to the rows that reached it. Returns the rows to print, the
 * stderr to append, and the exit status the actions impose (0 when they
 * impose none, even with stderr).
 */
export async function applyFindActions(
  stdout: ByteSource | null,
  texts: readonly string[],
  registry: MountRegistry,
  cwd: string,
  doors: FindActionDoors = {},
): Promise<[ByteSource | null, Uint8Array, number]> {
  const expr = parseFindExpression([...texts])
  if (!hasActions(expr) || stdout === null) return [stdout, new Uint8Array(), 0]
  const executeFn = doors.executeFn
  const execs = execActions(expr.actions)
  if (execs.length > 0 && executeFn === undefined) {
    return [null, enc.encode('find: -exec: no shell to run the command\n'), 1]
  }
  const sessionId = doors.sessionId ?? ''
  const childMounts = doors.childMounts ?? null
  const statPath = doors.statPath ?? null
  const text = new TextDecoder().decode(await materialize(stdout))
  const matches = text.split('\n').filter((p) => p !== '')
  const errors: Uint8Array[] = []
  const out: Uint8Array[] = []
  const batches = new Map<number, string[]>()
  const toDelete: string[] = []
  let exitCode = 0
  for (const path of matches) {
    for (const [position, action] of expr.actions.entries()) {
      if (action.kind === 'exec') {
        if (action.batch) {
          const bucket = batches.get(position) ?? []
          bucket.push(path)
          batches.set(position, bucket)
          continue
        }
        if (executeFn === undefined) break
        if (!(await runExec(executeFn, sessionId, registry, action, [path], out, errors))) break
      } else if (action.kind === 'ls') {
        const before = errors.length
        const row = await lsRow(path, registry, cwd, childMounts, statPath, errors)
        if (row !== null) out.push(row)
        else if (errors.length > before) exitCode = 1
      } else if (action.kind === 'delete') {
        toDelete.push(path)
      } else {
        out.push(enc.encode(path + (action.kind === 'print0' ? '\0' : '\n')))
      }
    }
  }
  for (const [position, action] of expr.actions.entries()) {
    const paths = batches.get(position)
    if (action.kind !== 'exec' || paths === undefined || executeFn === undefined) continue
    if (!(await runExec(executeFn, sessionId, registry, action, paths, out, errors))) exitCode = 1
  }
  if (toDelete.length > 0) {
    // Deepest-first so children are removed before parents. Skip
    // structural rows: mount points, and the namespace-only ancestors
    // above a nested mount, are not unlinkable entries; refusing matches
    // Unix semantics. Ancestors use the raw mount table like isMountRoot:
    // an ungranted mount still pins its ancestors in the namespace.
    const deletable = toDelete.filter((p) => {
      const virtual = resolvePath(p, cwd)
      return !registry.isMountRoot(virtual) && registry.descendantMounts(virtual).length === 0
    })
    const ordered = [...deletable].sort(
      (a, b) => (b.match(/\//g) ?? []).length - (a.match(/\//g) ?? []).length,
    )
    for (const path of ordered) {
      if (!(await deleteRow(path, registry, cwd, errors))) exitCode = 1
    }
  }
  const body = concat(out)
  return [body.byteLength > 0 ? body : null, concat(errors), exitCode]
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return merged
}
