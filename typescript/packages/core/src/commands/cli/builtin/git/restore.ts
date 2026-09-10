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

import git from 'isomorphic-git'

import { IOResult } from '../../../../io/types.ts'
import type { CommandFnResult } from '../../../config.ts'
import { FlagView } from '../../../spec/types.ts'
import type { CLIInvocation } from '../../types.ts'
import { headEntries } from './changes.ts'
import {
  GitError,
  NoRestorePathsError,
  NoWorkspaceError,
  UnknownPathspecError,
  UnknownSwitchError,
  UnresolvableSourceError,
} from './errors.ts'
import { readIndex, updateIndex, type StagedEntry } from './index_file.ts'
import { removeEmptyParents, removeFile, restoreEntry, under } from './io.ts'
import { matched, repoRelative } from './pathspec.ts'
import { opened, repoArgs, type Repo } from './repo.ts'
import { restored } from './reset.ts'
import { resolveCommit } from './revparse.ts'
import { commitEntries, treeEntries, type TreeEntry } from './tree.ts'
import type { IndexEntry } from './types.ts'
import { checkOperands, fatal, startPoint } from './util.ts'
import { compareCodePoints } from '../../../../utils/sort.ts'

/** The parsed shape of a `git restore` invocation. */
interface RestoreFlags {
  /** `--staged`, put the index back. */
  readonly staged: boolean
  /**
   * `--worktree`, put the working tree back. The default when `--staged` is
   * absent, which is git's rule.
   */
  readonly worktree: boolean
  /**
   * `--source`, the tree to restore from. Undefined means the index for the
   * working tree and HEAD for the index.
   */
  readonly source: string | undefined
}

/** Read the raw restore flag kwargs into a frozen struct. */
function parseFlags(fl: FlagView): RestoreFlags {
  const staged = fl.asBool('staged')
  return { staged, worktree: fl.asBool('worktree') || !staged, source: fl.asStr('source') }
}

/** The index read as a tree: every path with its mode and blob id. */
export function indexTree(entries: ReadonlyMap<string, IndexEntry>): Map<string, TreeEntry> {
  const out = new Map<string, TreeEntry>()
  for (const [path, entry] of entries)
    out.set(path, { oid: entry.oid, mode: entry.mode.toString(8) })
  return out
}

/**
 * Every path a `--source` names, commit-ish or tree-ish.
 *
 * git takes any tree-ish here, so a raw tree id
 * (`--source=$(git rev-parse HEAD^{tree})`) is as good as a branch. A
 * commit-ish is tried first because it is what the option is normally spelled
 * with and it is the only form carrying ancestry suffixes; a revision neither
 * reading resolves is unresolvable.
 */
export async function sourceTree(repo: Repo, revision: string): Promise<Map<string, TreeEntry>> {
  try {
    return await commitEntries(repo, await resolveCommit(repo, revision))
  } catch {
    // Not a commit-ish. The id is read as a tree before the revision is called
    // unresolvable, never instead of reporting it: the throw below is what a
    // spelling neither reading accepts still gets.
  }
  try {
    const oid = await git.expandOid({ ...repoArgs(repo), oid: revision })
    return await treeEntries(repo, oid)
  } catch {
    throw new UnresolvableSourceError(revision)
  }
}

/**
 * Put paths back to what a source records.
 *
 * Two targets and one source, git's own model. `--staged` restores the index
 * and `--worktree` the working tree; the default is the working tree alone. The
 * source is the index for the working tree and HEAD for the index unless
 * `--source` names a tree, in which case a selected path the source does not
 * hold is removed from whichever target is being restored, since that is what
 * "make it match the source" means for it. Pinned against git 2.50.1.
 */
export async function restore(inv: CLIInvocation): Promise<CommandFnResult> {
  const doors = inv.doors ?? {}
  const texts = [...inv.texts]
  const fl = new FlagView(inv.flags)
  try {
    const dispatch = doors.dispatch
    const statPath = doors.statPath
    if (statPath === undefined || dispatch === undefined) {
      throw new NoWorkspaceError()
    }
    checkOperands(texts, UnknownSwitchError)
    if (texts.length === 0) throw new NoRestorePathsError()
    const flags = parseFlags(fl)
    const repo = await opened(fl, doors)
    const state = await readIndex(repo, dispatch)
    const held = indexTree(state.entries)
    let source: Map<string, TreeEntry> | null
    if (flags.source !== undefined) {
      source = await sourceTree(repo, flags.source)
    } else if (flags.staged) {
      source = (await headEntries(repo)) ?? new Map<string, TreeEntry>()
    } else {
      source = null
    }
    const tree = source ?? held
    const names = new Set([...held.keys(), ...tree.keys()])
    const start = startPoint(fl)
    const selected = new Set<string>()
    for (const operand of texts) {
      const hits = matched(names, repoRelative(repo.location, start, operand))
      if (hits.size === 0) throw new UnknownPathspecError(operand)
      for (const path of hits) selected.add(path)
    }
    const present = [...selected].filter((name) => tree.has(name)).sort(compareCodePoints)
    const absent = [...selected].filter((name) => !tree.has(name)).sort(compareCodePoints)
    if (flags.staged) {
      const staged = new Map<string, StagedEntry>()
      for (const name of present) {
        const entry = tree.get(name)
        if (entry !== undefined)
          staged.set(name, restored(entry.oid, Number.parseInt(entry.mode, 8)))
      }
      await updateIndex(repo, staged, absent)
    }
    if (flags.worktree) {
      for (const name of present) {
        const entry = tree.get(name)
        if (entry === undefined) continue
        const { blob } = await git.readBlob({ ...repoArgs(repo), oid: entry.oid })
        await restoreEntry(
          dispatch,
          under(repo.location.worktree, name),
          entry.mode,
          blob,
          doors.ns?.links ?? null,
        )
      }
      for (const name of absent) {
        const path = under(repo.location.worktree, name)
        await removeFile(dispatch, path)
        await removeEmptyParents(dispatch, path, repo.location.worktree)
      }
    }
  } catch (err) {
    if (err instanceof GitError) return fatal(err)
    throw err
  }
  return [null, new IOResult()]
}
