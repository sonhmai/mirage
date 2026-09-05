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

import { compareCodePoints } from '../../utils/sort.ts'
import { resolvePath } from '../../utils/path.ts'
import { fsStrerror, isFsError } from '../../utils/errors.ts'
import { shellJoin } from '../../shell/join.ts'
import { type ByteSource, materialize } from '../../io/types.ts'
import { getCurrentSession, runWithSuspendedOpPolicies } from '../../context/session_context.ts'
import { preOpsGate } from '../../policy/policies.ts'
import type { PathSpec } from '../../types.ts'
import type { MountRegistry } from '../mount/registry.ts'
import { lookup } from '../lookup/lookup.ts'
import { Consumer } from '../lookup/types.ts'
import type { NamespaceView, StatPath } from '../../ops/types.ts'
import {
  EXEC_PLACEHOLDER,
  execActions,
  type ExecAction,
  type FindAction,
  type FindExpr,
  parseFindExpression,
} from '../../commands/builtin/find_parse.ts'
import type { ExecuteFn } from '../expand/node.ts'
import type { DispatchFn } from '../../runtime/types.ts'

export interface FindActionDoors {
  // Runs an `-exec` line in the session; absent outside a workspace,
  // where `-exec` is refused.
  executeFn?: ExecuteFn
  sessionId?: string
  // The name plane's facts, threaded into the -ls sub-dispatch so a
  // namespace-only row (a mount point, a symlink) renders the way
  // `ls -l` renders it.
  ns?: NamespaceView | null
  // Dispatcher stat, threaded with it and used to find a
  // slash-carrying `-exec` head.
  statPath?: StatPath | null
  // The op dispatcher a `-delete` unlinks a symlink row through, since
  // the row is namespace state no mount's `rm` can reach.
  dispatch?: DispatchFn | null
}

const enc = new TextEncoder()

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
 * Whether `execvp` would fail to find an `-exec` head word. A head
 * carrying a slash is a file the loader runs, which no builtin, function
 * or CLI can claim, so it is statted where the line would read it; any
 * other head is looked up by name across the layers dispatch consults.
 * Outside a workspace there is no stat and the loader answers for itself.
 */
async function headMissing(
  head: string,
  registry: MountRegistry,
  cwd: string,
  statPath: StatPath | null,
): Promise<boolean> {
  if (head.includes('/')) {
    return statPath !== null && (await statPath(resolvePath(head, cwd))) === null
  }
  const sess = getCurrentSession()
  return sess !== null && lookup(head, sess, registry) === Consumer.UNKNOWN
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
  cwd: string,
  statPath: StatPath | null,
  action: ExecAction,
  paths: readonly string[],
  out: Uint8Array[],
  errors: Uint8Array[],
): Promise<boolean> {
  const head = action.argv[0] ?? ''
  if (await headMissing(head, registry, cwd, statPath)) {
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

/**
 * Delete one accepted row; returns whether it succeeded.
 *
 * A symlink row came from the namespace, which no backend can see, so
 * it is unlinked through the op dispatcher the way `rm link` is
 * (`stripLinkOperands`): that door is where the path gate, the turf's
 * mode and the op ledger fire, and it removes the node the mount's `rm`
 * would only report as absent. Every other row is a backend entry,
 * removed by the mount's own `rm`.
 */
async function deleteRow(
  ps: PathSpec,
  registry: MountRegistry,
  cwd: string,
  ns: NamespaceView | null,
  dispatch: DispatchFn | null,
  errors: Uint8Array[],
): Promise<boolean> {
  const path = ps.rawPath || ps.virtual
  const link = dispatch !== null && (ns?.links?.statAt(ps.virtual) ?? null) !== null
  const mount = registry.tryMountFor(ps.virtual)
  if (mount === null && !link) {
    errors.push(enc.encode(`find: cannot delete '${path}': no mount\n`))
    return false
  }
  try {
    if (link) {
      await dispatch('unlink', ps)
      return true
    }
    if (mount === null) return false
    // -delete is find's own action, not an `rm` line, so no command rule
    // sees it; it is a removal all the same, so it clears the op door a
    // path rule guards (the same gate `ws.fs`, FUSE and a redirect
    // clear), by the session the line runs under, and a refusal reports
    // in find's voice. The delegated rm's own slots are suspended for the
    // call, so the deletion admits exactly once. -d so a directory
    // emptied by the rows before it in -depth order is removable,
    // matching GNU -delete's rmdir behavior.
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
      // rm names the reason last (`rm: cannot remove '/w/d': Directory
      // not empty`), and find says the same thing about the row as it
      // was typed.
      const line = new TextDecoder().decode(await materialize(rmIo.stderr)).trim()
      const why = line.slice(line.lastIndexOf(': ') + 2)
      errors.push(enc.encode(`find: cannot delete '${path}'${why ? `: ${why}` : ''}\n`))
      return false
    }
    return true
  } catch (err) {
    // GNU words it with the errno text; a policy refusal carries its
    // reason there.
    const msg =
      (isFsError(err) ? fsStrerror(err) : null) ??
      (err instanceof Error ? err.message : String(err))
    errors.push(enc.encode(`find: cannot delete '${path}': ${msg}\n`))
    return false
  }
}

async function lsRow(
  ps: PathSpec,
  registry: MountRegistry,
  cwd: string,
  ns: NamespaceView | null,
  statPath: StatPath | null,
  errors: Uint8Array[],
): Promise<Uint8Array | null> {
  const path = ps.rawPath || ps.virtual
  const mount = registry.tryMountFor(ps.virtual)
  if (mount === null) {
    errors.push(enc.encode(`find: '${path}': no mount\n`))
    return null
  }
  try {
    const [lsOut, lsIo] = await mount.executeCmd(
      'ls',
      [ps],
      [],
      { args_l: true, d: true },
      {
        stdin: null,
        cwd,
        ...(ns !== null ? { ns } : {}),
        ...(statPath !== null ? { statPath } : {}),
      },
    )
    if (lsIo.exitCode !== 0) {
      // ls names the reason last, and find says the same thing about
      // the row as it was typed, the way a failed -delete re-voices rm.
      const said = new TextDecoder().decode(await materialize(lsIo.stderr)).trim()
      const why = said.slice(said.lastIndexOf(': ') + 2)
      errors.push(enc.encode(`find: '${path}'${why === '' ? '' : `: ${why}`}\n`))
      return null
    }
    if (lsOut === null) return null
    const line = new TextDecoder().decode(await materialize(lsOut)).replace(/\n+$/, '')
    return line === '' ? null : enc.encode(`${line}\n`)
  } catch (err) {
    const why =
      (isFsError(err) ? fsStrerror(err) : null) ??
      (err instanceof Error ? err.message : String(err))
    errors.push(enc.encode(`find: '${path}': ${why}\n`))
    return null
  }
}

/**
 * GNU's `-depth` order over sorted siblings: a directory's contents, each
 * sorted, then the directory. The final component is flagged so a path
 * sorts after its descendants, whose entry at that depth carries the same
 * name unflagged.
 */
export function compareDepthFirst(a: string, b: string): number {
  const pa = a.split('/')
  const pb = b.split('/')
  const n = Math.min(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const byName = compareCodePoints(pa[i] ?? '', pb[i] ?? '')
    if (byName !== 0) return byName
    const fa = i === pa.length - 1 ? 1 : 0
    const fb = i === pb.length - 1 ? 1 : 0
    if (fa !== fb) return fa - fb
  }
  return pa.length - pb.length
}

/** Whether a row is a mount point or a namespace-only ancestor of one,
 * which are not unlinkable entries. Ancestors use the raw mount table
 * like isMountRoot: an ungranted mount still pins its ancestors in the
 * namespace. */
function structural(path: PathSpec, registry: MountRegistry): boolean {
  const virtual = path.virtual
  return registry.isMountRoot(virtual) || registry.descendantMounts(virtual).length > 0
}

/** Whether the actions differ from the implicit print: one explicit
 * `-print` is exactly what the backend already rendered, two of them
 * print every row twice, as GNU does. */
function hasActions(expr: FindExpr): boolean {
  return expr.actions.length > 1 || expr.actions.some((a) => a.kind !== 'print')
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
 * could not delete or list, and either ends that row's chain; a failing
 * per-match run is not, and neither
 * is a command that cannot be found, which GNU reports per match and
 * carries on from with exit 0. An action other than `-print` suppresses
 * the implicit print. `-delete` runs at its position, so a later `-exec`
 * sees the row gone, and a row it cannot delete ends the chain with GNU's
 * line and find's exit 1. It also turns on `-depth`, which orders every
 * directory after its contents, the only order a tree can be removed in;
 * `-depth` alone reorders the implicit print the same way. Returns the
 * rows to print, the stderr to append, and the exit status the actions
 * impose (0 when they impose none, even with stderr).
 */
export async function applyFindActions(
  stdout: ByteSource | null,
  matchedPaths: readonly PathSpec[] | null,
  texts: readonly string[],
  registry: MountRegistry,
  cwd: string,
  doors: FindActionDoors = {},
): Promise<[ByteSource | null, Uint8Array, number]> {
  const expr = parseFindExpression([...texts])
  const reorders = expr.depthFirst && expr.printf === null
  if (stdout === null || !(hasActions(expr) || reorders)) return [stdout, new Uint8Array(), 0]
  const executeFn = doors.executeFn
  const execs = execActions(expr.actions)
  if (execs.length > 0 && executeFn === undefined) {
    return [null, enc.encode('find: -exec: no shell to run the command\n'), 1]
  }
  const sessionId = doors.sessionId ?? ''
  const ns = doors.ns ?? null
  const statPath = doors.statPath ?? null
  const dispatch = doors.dispatch ?? null
  if (matchedPaths === null)
    return [null, enc.encode('find: actions require structured matches\n'), 1]
  const matches = [...matchedPaths]
  if (reorders)
    matches.sort((a, b) => compareDepthFirst(a.rawPath || a.virtual, b.rawPath || b.virtual))
  // An expression with no action of its own prints, which is the one
  // implicit action -depth reorders.
  const actions: FindAction[] = expr.actions.length > 0 ? expr.actions : [{ kind: 'print' }]
  const errors: Uint8Array[] = []
  const out: Uint8Array[] = []
  const batches = new Map<number, string[]>()
  let exitCode = 0
  for (const match of matches) {
    const path = match.rawPath || match.virtual
    for (const [position, action] of actions.entries()) {
      if (action.kind === 'exec') {
        if (action.batch) {
          const bucket = batches.get(position) ?? []
          bucket.push(path)
          batches.set(position, bucket)
          continue
        }
        if (executeFn === undefined) break
        if (
          !(await runExec(
            executeFn,
            sessionId,
            registry,
            cwd,
            statPath,
            action,
            [path],
            out,
            errors,
          ))
        )
          break
      } else if (action.kind === 'ls') {
        const before = errors.length
        const row = await lsRow(match, registry, cwd, ns, statPath, errors)
        if (row !== null) out.push(row)
        else if (errors.length > before) {
          // A row -ls cannot list is false, so the chain ends for it, as
          // GNU's does.
          exitCode = 1
          break
        }
      } else if (action.kind === 'delete') {
        // A structural row is skipped, not refused, the way Unix leaves
        // a mount point in place.
        if (structural(match, registry)) continue
        if (!(await deleteRow(match, registry, cwd, ns, dispatch, errors))) {
          exitCode = 1
          break
        }
      } else {
        out.push(enc.encode(path + (action.kind === 'print0' ? '\0' : '\n')))
      }
    }
  }
  for (const [position, action] of actions.entries()) {
    const paths = batches.get(position)
    if (action.kind !== 'exec' || paths === undefined || executeFn === undefined) continue
    if (!(await runExec(executeFn, sessionId, registry, cwd, statPath, action, paths, out, errors)))
      exitCode = 1
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
