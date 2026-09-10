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

import { IOResult } from '../../../../io/types.ts'
import type { LinkView, StatPath } from '../../../../ops/types.ts'
import { FileType, type FileStat } from '../../../../types.ts'
import { isMissingPath } from '../../../../utils/errors.ts'
import type { CommandFnResult } from '../../../config.ts'
import { FlagView } from '../../../spec/types.ts'
import type { CLIInvocation } from '../../types.ts'
import {
  GitError,
  MoveRefusedError,
  MoveUsageError,
  NotADirectoryDestinationError,
  NoWorkspaceError,
  RenameFailedError,
  UnknownSwitchError,
} from './errors.ts'
import { readIndex, updateIndex, type StagedEntry } from './index_file.ts'
import { removeFile, renamePath, under } from './io.ts'
import { basename } from './path.ts'
import { repoRelative } from './pathspec.ts'
import { opened } from './repo.ts'
import type { Dispatch, IndexEntry, RepoLocation } from './types.ts'
import { checkOperands, fatal, startPoint } from './util.ts'
import { compareCodePoints } from '../../../../utils/sort.ts'

const ENC = new TextEncoder()

// git's own wording for each way a source can be refused, in the shape
// `fatal: <reason>, source=<src>, destination=<dst>`.
const BAD_SOURCE = 'bad source'
const INTO_ITSELF = 'can not move directory into itself'
const DESTINATION_EXISTS = 'destination exists'
const DESTINATION_ALREADY_EXISTS = 'destination already exists'
const SOURCE_DIRECTORY_EMPTY = 'source directory is empty'
const NOT_UNDER_VERSION_CONTROL = 'not under version control'

/** The parsed shape of a `git mv` invocation. */
export interface MvFlags {
  /** `-f`, overwrite an existing destination file. */
  readonly force: boolean
  /** `-k`, skip a source that cannot move rather than refusing the line. */
  readonly skip: boolean
  /** `-n`, report what would move and move nothing. */
  readonly dryRun: boolean
  /** `-v`, print one line per move; implied by `-n`. */
  readonly verbose: boolean
}

/** Read the raw mv flag kwargs into a frozen struct. */
function parseFlags(fl: FlagView): MvFlags {
  const dryRun = fl.asBool('dry_run')
  return {
    force: fl.asBool('force'),
    skip: fl.asBool('k'),
    dryRun,
    verbose: fl.asBool('verbose') || dryRun,
  }
}

/** One source and where it goes. */
export interface Move {
  /** Repository-relative path being moved. */
  readonly source: string
  /**
   * Repository-relative path it moves to, already joined with the source's
   * basename when the destination was a directory.
   */
  readonly destination: string
  /**
   * The tracked paths that move with it: the source itself for a file,
   * everything under it for a directory.
   */
  readonly paths: readonly string[]
  /** Whether the source is a directory. */
  readonly directory: boolean
}

/** What one refusal check found: a reason, or the paths that move. */
interface Verdict {
  readonly reason: string | null
  readonly paths: readonly string[]
  readonly directory: boolean
}

/** What sits at a path, without following a link. */
async function lstat(
  statPath: StatPath,
  links: LinkView | null,
  path: string,
): Promise<FileStat | null> {
  const link = links?.statAt(path) ?? null
  if (link !== null) return link
  return statPath(path)
}

/** Whether a repository-relative path sits inside a directory. */
function inside(path: string, directory: string): boolean {
  return directory === '' || path.startsWith(`${directory}/`)
}

/** Where one tracked path lands after a move. */
export function movedPath(move: Move, path: string): string {
  if (!move.directory) return move.destination
  return `${move.destination}${path.slice(move.source.length)}`
}

/** Whether one source can move, in git's own order of refusals. */
export async function check(
  statPath: StatPath,
  links: LinkView | null,
  location: RepoLocation,
  source: string,
  destination: string,
  tracked: ReadonlySet<string>,
  force: boolean,
): Promise<Verdict> {
  const info = await lstat(statPath, links, under(location.worktree, source))
  if (info === null) return { reason: BAD_SOURCE, paths: [], directory: false }
  if (destination === source || destination.startsWith(`${source}/`)) {
    return { reason: INTO_ITSELF, paths: [], directory: false }
  }
  const target = await lstat(statPath, links, under(location.worktree, destination))
  if (info.type === FileType.DIRECTORY) {
    if (target !== null) return { reason: DESTINATION_ALREADY_EXISTS, paths: [], directory: true }
    const held = [...tracked].filter((path) => inside(path, source)).sort(compareCodePoints)
    if (held.length === 0) return { reason: SOURCE_DIRECTORY_EMPTY, paths: [], directory: true }
    return { reason: null, paths: held, directory: true }
  }
  if (!tracked.has(source))
    return { reason: NOT_UNDER_VERSION_CONTROL, paths: [], directory: false }
  if (target !== null && (!force || target.type === FileType.DIRECTORY)) {
    return { reason: DESTINATION_EXISTS, paths: [], directory: false }
  }
  return { reason: null, paths: [source], directory: false }
}

/**
 * Decide every move before making any, which is git's order too.
 *
 * The last operand is the destination. With several sources it has to be a
 * directory that exists; with one, an existing directory takes the source
 * under its own name and anything else is the new name.
 */
export async function plan(
  statPath: StatPath,
  links: LinkView | null,
  location: RepoLocation,
  start: string,
  operands: readonly string[],
  tracked: ReadonlySet<string>,
  flags: MvFlags,
): Promise<Move[]> {
  const destination = repoRelative(location, start, operands[operands.length - 1] ?? '')
  const target = await lstat(statPath, links, under(location.worktree, destination))
  const into = destination === '' || target?.type === FileType.DIRECTORY
  if (operands.length > 2 && !into) throw new NotADirectoryDestinationError(destination)
  const moves: Move[] = []
  for (const operand of operands.slice(0, -1)) {
    const source = repoRelative(location, start, operand)
    const landing = into
      ? destination === ''
        ? basename(source)
        : `${destination}/${basename(source)}`
      : destination
    const verdict = await check(statPath, links, location, source, landing, tracked, flags.force)
    if (verdict.reason !== null) {
      if (flags.skip) continue
      throw new MoveRefusedError(verdict.reason, source, landing)
    }
    moves.push({ source, destination: landing, paths: verdict.paths, directory: verdict.directory })
  }
  return moves
}

/**
 * Make one move in the working tree.
 *
 * The mount's own rename, so a directory carries its untracked files along.
 * Under `-f` a file already at the destination goes first, since not every
 * mount renames over one.
 */
async function apply(
  dispatch: Dispatch,
  location: RepoLocation,
  move: Move,
  force: boolean,
): Promise<void> {
  const source = under(location.worktree, move.source)
  const destination = under(location.worktree, move.destination)
  if (force && !move.directory) await removeFile(dispatch, destination)
  try {
    await renamePath(dispatch, source, destination)
  } catch (err) {
    if (isMissingPath(err)) throw new RenameFailedError(move.source)
    throw err
  }
}

/**
 * Move or rename a file or directory, and stage the move.
 *
 * The index entries are re-keyed with their blob ids and modes untouched, which
 * is what lets `status` read the result as a rename rather than a delete beside
 * an add.
 */
export async function mv(inv: CLIInvocation): Promise<CommandFnResult> {
  const doors = inv.doors ?? {}
  const texts = [...inv.texts]
  const fl = new FlagView(inv.flags)
  const lines: string[] = []
  try {
    const dispatch = doors.dispatch
    const statPath = doors.statPath
    if (statPath === undefined || dispatch === undefined) {
      throw new NoWorkspaceError()
    }
    checkOperands(texts, UnknownSwitchError)
    const flags = parseFlags(fl)
    if (texts.length < 2) throw new MoveUsageError()
    const repo = await opened(fl, doors)
    const state = await readIndex(repo, dispatch)
    const tracked = new Set(state.entries.keys())
    const moves = await plan(
      statPath,
      doors.ns?.links ?? null,
      repo.location,
      startPoint(fl),
      texts,
      tracked,
      flags,
    )
    if (flags.dryRun) {
      for (const move of moves) {
        lines.push(`Checking rename of '${move.source}' to '${move.destination}'`)
      }
    }
    if (flags.verbose) {
      for (const move of moves) lines.push(`Renaming ${move.source} to ${move.destination}`)
    }
    if (!flags.dryRun) {
      const staged = new Map<string, StagedEntry>()
      const removed: string[] = []
      for (const move of moves) {
        await apply(dispatch, repo.location, move, flags.force)
        for (const path of move.paths) {
          const entry: IndexEntry | undefined = state.entries.get(path)
          if (entry === undefined) continue
          removed.push(path)
          staged.set(movedPath(move, path), { oid: entry.oid, mode: entry.mode, size: entry.size })
        }
      }
      await updateIndex(repo, staged, removed)
    }
  } catch (err) {
    if (err instanceof GitError) return fatal(err)
    throw err
  }
  if (lines.length === 0) return [null, new IOResult()]
  return [ENC.encode(lines.map((line) => `${line}\n`).join('')), new IOResult()]
}
