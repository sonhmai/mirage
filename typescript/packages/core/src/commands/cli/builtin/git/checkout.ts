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
import { headCommit } from './branch.ts'
import { headEntries, workChanges } from './changes.ts'
import {
  BadStartPointError,
  BranchExistsError,
  CheckoutConflictError,
  GitError,
  NoWorkspaceError,
  UnknownPathspecError,
  UnknownSwitchError,
} from './errors.ts'
import { short } from './format.ts'
import { readIndex, updateIndex, type StagedEntry } from './index_file.ts'
import { removeFile, restoreEntry, under } from './io.ts'
import { record } from './reflog.ts'
import { BRANCH_PREFIX, detachHead, loadRefs, readHead, setHead, writeRef } from './refs.ts'
import { under as inside } from './pathspec.ts'
import { opened, repoArgs, type Repo } from './repo.ts'
import { resolveCommit } from './revparse.ts'
import { restored } from './reset.ts'
import { commitEntries, type TreeEntry } from './tree.ts'
import type { LinkView, StatPath } from '../../../../ops/types.ts'
import type { Dispatch, HeadRef, IndexEntry } from './types.ts'
import { checkOperands, escaped, fatal } from './util.ts'
import { scan, UNTRACKED_ALL } from './worktree.ts'
import { compareCodePoints } from '../../../../utils/sort.ts'

const ENC = new TextEncoder()

// What checkout records in the reflog. There is no committer here, only a move
// of HEAD, so the same stated identity commit uses is reused.
const IDENTITY = 'mirage <mirage@localhost>'

// git's word-for-word warning when HEAD leaves a branch, kept verbatim. It is
// the only thing telling a caller that commits made from here become unreachable
// once HEAD moves again, and an agent that has read this text before should not
// have to read a paraphrase of it.
const DETACHED_ADVICE = `You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false
`

/**
 * Which uncommitted changes the switch would overwrite.
 *
 * A file edited but not committed survives a branch switch when both branches
 * record the same content for it: git carries the edit across rather than
 * refusing, and only refuses when the target branch would have to write over it.
 * Pinned against git 2.47.
 *
 * Deliberate divergence for a *staged* change to such a file: git carries that
 * across too, applying its own two-way merge to the index, and mirage refuses
 * instead. Refusing is the safe half of the trade. Getting the merge wrong loses
 * staged work with no reflog to recover it from, and a refusal that names the
 * file is something the caller can act on, where a silent clobber is not.
 */
function conflicts(
  before: ReadonlyMap<string, TreeEntry>,
  after: ReadonlyMap<string, TreeEntry>,
  dirty: ReadonlySet<string>,
): string[] {
  return [...dirty]
    .filter((path) => {
      const old = before.get(path)
      const now = after.get(path)
      return old?.oid !== now?.oid || old?.mode !== now?.mode
    })
    .sort(compareCodePoints)
}

/**
 * Which untracked files the tree being switched to would write over.
 *
 * An untracked file is in neither tree and neither index, so the comparison
 * above cannot see it, and writing the target branch's blob over it destroys
 * the only copy there is. git refuses and names each one. An ignored file is
 * not in this list and git overwrites it silently, which is the same split.
 * Pinned against git 2.50.
 *
 * Equality is not the whole test. An untracked file `slot` is also in the way
 * of a target that records `slot/child`, because the directory cannot be
 * created without deleting it; git names the untracked file itself there, not
 * the entry that needs the room.
 */
function overwritten(
  after: ReadonlyMap<string, TreeEntry>,
  untracked: readonly string[],
): string[] {
  const names = [...after.keys()]
  return untracked
    .filter((path) => after.has(path) || names.some((name) => inside(name, path)))
    .sort(compareCodePoints)
}

/**
 * Which directories the switch would empty of untracked files.
 *
 * The mirror of the case above: the target records a *file* where the working
 * tree has a directory, so writing it means removing the directory, and
 * anything untracked inside it is gone. git words this one differently and
 * names the directory rather than the files, since the directory is what the
 * caller has to move. Pinned against git 2.50.1.
 */
function lostDirectories(
  after: ReadonlyMap<string, TreeEntry>,
  untracked: readonly string[],
): string[] {
  return [...after.keys()]
    .filter((name) => untracked.some((path) => inside(path, name)))
    .sort(compareCodePoints)
}

/**
 * Make the working tree and index match the tree being switched to.
 *
 * Only paths whose recorded content differs are touched, so a file that is the
 * same on both branches keeps whatever the working tree has, including an
 * uncommitted edit. A path carried across keeps its index entry too, which is
 * what preserves a staged change that both branches happen to agree about.
 */
async function switchTo(
  repo: Repo,
  dispatch: Dispatch,
  before: ReadonlyMap<string, TreeEntry>,
  after: ReadonlyMap<string, TreeEntry>,
  keep: ReadonlySet<string>,
  held: ReadonlyMap<string, IndexEntry>,
  links: LinkView | null,
): Promise<void> {
  for (const [path, entry] of after) {
    const old = before.get(path)
    if (old?.oid === entry.oid && old.mode === entry.mode) continue
    if (keep.has(path)) continue
    const { blob } = await git.readBlob({ ...repoArgs(repo), oid: entry.oid })
    await restoreEntry(dispatch, under(repo.location.worktree, path), entry.mode, blob, links)
  }
  for (const path of before.keys()) {
    if (after.has(path)) continue
    await removeFile(dispatch, under(repo.location.worktree, path))
  }
  const state = await readIndex(repo, dispatch)
  const staged = new Map<string, StagedEntry>()
  for (const [path, entry] of after) {
    const carried = held.get(path)
    if (keep.has(path) && carried !== undefined) {
      staged.set(path, { oid: carried.oid, mode: carried.mode, size: carried.size })
    } else {
      staged.set(path, restored(entry.oid, Number.parseInt(entry.mode, 8)))
    }
  }
  const removed = [...state.entries.keys(), ...state.conflicts.keys()].filter(
    (path) => !after.has(path),
  )
  await updateIndex(repo, staged, removed)
}

/**
 * git's line for leaving a detached HEAD, empty when it was on a branch.
 *
 * Printed before the line saying where HEAD went, because a commit made while
 * detached is reachable from nothing once HEAD moves, and this is the one place
 * its id is still written down for the caller.
 */
export async function previousPosition(repo: Repo, head: HeadRef): Promise<string> {
  if (head.commit === null) return ''
  const { commit } = await git.readCommit({ ...repoArgs(repo), oid: head.commit })
  const subject = commit.message.split('\n')[0] ?? ''
  return `Previous HEAD position was ${short(head.commit, repo.abbrev)} ${subject}\n`
}

/**
 * Move HEAD, the index and the working tree to a commit.
 *
 * The one procedure `checkout` and `switch` share, since the two differ only in
 * what they accept and how they word a miss. Refuses rather than overwriting
 * when the move would destroy work that is not committed, whether that is an
 * edit to a tracked file or an untracked file the target holds. That check is
 * the whole reason either verb is safe to offer: without it a branch switch
 * silently throws away whatever was changed and not staged, and there is no
 * reflog here to get it back from.
 *
 * @param dispatch workspace op dispatcher
 * @param statPath dispatcher-backed stat, both channels
 * @param links the name plane's link facts, null outside a workspace
 * @param repo the opened repository
 * @param known every ref the repository publishes
 * @param head what HEAD pointed at before the move
 * @param oid the commit to move to
 * @param target the operand as the user spelled it, for the reflog
 * @param ref the branch to attach HEAD to, null to detach it at the commit
 * @param creating whether `ref` is a new branch to write first
 * @returns the paths whose uncommitted changes were carried across
 */
export async function moveHead(
  dispatch: Dispatch,
  statPath: StatPath,
  links: LinkView | null,
  repo: Repo,
  known: ReadonlyMap<string, string>,
  head: HeadRef,
  oid: string,
  target: string,
  ref: string | null,
  creating: boolean,
): Promise<Set<string>> {
  const before = (await headEntries(repo)) ?? new Map<string, TreeEntry>()
  const after = await commitEntries(repo, oid)
  const state = await readIndex(repo, dispatch)
  const tracked = new Set(state.entries.keys())
  // UNTRACKED_ALL, not the mode status uses: "normal" collapses a wholly
  // untracked directory to one `dir/` entry, and a collision has to be
  // decided per file. git names the file inside such a directory, so the
  // list has to hold it.
  const found = await scan(dispatch, statPath, repo.location, tracked, UNTRACKED_ALL, links)
  const unstaged = await workChanges(repo, dispatch, repo.location.worktree, state.entries, found)
  // Both kinds of uncommitted change count: an edit in the working tree, and
  // one already staged. Leaving the staged ones out is what silently threw
  // them away.
  const stagedPaths = [...state.entries.entries()]
    .filter(([path, entry]) => {
      const recorded = before.get(path)
      return recorded?.oid !== entry.oid || Number.parseInt(recorded.mode, 8) !== entry.mode
    })
    .map(([path]) => path)
  const dirty = new Set([...unstaged.keys(), ...stagedPaths])
  const blocked = conflicts(before, after, dirty)
  const clobbered = overwritten(after, found.untracked)
  const lost = lostDirectories(after, found.untracked)
  if (blocked.length > 0 || clobbered.length > 0 || lost.length > 0) {
    throw new CheckoutConflictError(blocked, clobbered, lost)
  }
  await switchTo(repo, dispatch, before, after, dirty, state.entries, links)
  if (creating && ref !== null) await writeRef(dispatch, repo.location.commondir, ref, oid)
  if (ref !== null) await setHead(dispatch, repo.location.gitdir, ref)
  else await detachHead(dispatch, repo.location.gitdir, oid)
  const where = head.branch ?? short(head.commit ?? '', repo.abbrev)
  await record(
    dispatch,
    repo.location.gitdir,
    ref,
    headCommit(known, head),
    oid,
    IDENTITY,
    Math.floor(Date.now() / 1000),
    `checkout: moving from ${where} to ${target}`,
  )
  return dirty
}

/**
 * Switch the working tree to another branch or commit.
 *
 * Refuses rather than overwriting when the switch would destroy work that is not
 * committed; see `moveHead`, which does the moving for `switch` as well.
 */
export async function checkout(inv: CLIInvocation): Promise<CommandFnResult> {
  const doors = inv.doors ?? {}
  const texts = [...inv.texts]
  const fl = new FlagView(inv.flags)
  let carried: string
  let note: string
  try {
    const dispatch = doors.dispatch
    const statPath = doors.statPath
    if (statPath === undefined || dispatch === undefined) {
      throw new NoWorkspaceError()
    }
    checkOperands(texts, UnknownSwitchError, escaped(inv.argv))
    const target = texts[0]
    if (target === undefined) throw new UnknownPathspecError('')
    const repo = await opened(fl, doors)
    const head = await readHead(dispatch, repo.location.gitdir)
    const creating = fl.asBool('b')
    const ref = `${BRANCH_PREFIX}${target}`
    const known = await loadRefs(dispatch, repo.location.gitdir, repo.location.commondir)
    if (creating && known.has(ref)) throw new BranchExistsError(target)
    if (!creating && !known.has(ref) && target !== head.branch) {
      try {
        await resolveCommit(repo, target)
      } catch {
        throw new UnknownPathspecError(target)
      }
    }
    if (!creating && target === head.branch) {
      return [null, new IOResult({ stderr: ENC.encode(`Already on '${target}'\n`) })]
    }
    // `checkout -b <new> [<start>]` branches from the start point when one is
    // given, HEAD otherwise. Forcing HEAD here put the new branch on the
    // current commit and dropped the operand without a word, so every commit
    // after it landed on the wrong history.
    const startPoint = creating ? texts[1] : undefined
    let oid: string
    if (startPoint !== undefined) {
      try {
        oid = await resolveCommit(repo, startPoint)
      } catch {
        throw new BadStartPointError(startPoint, target)
      }
    } else {
      oid = await resolveCommit(repo, creating ? 'HEAD' : target)
    }
    const attached = creating || known.has(ref)
    const dirty = await moveHead(
      dispatch,
      statPath,
      doors.ns?.links ?? null,
      repo,
      known,
      head,
      oid,
      target,
      attached ? ref : null,
      creating,
    )
    carried = [...dirty]
      .sort(compareCodePoints)
      .map((path) => `M\t${path}\n`)
      .join('')
    note = await previousPosition(repo, head)
    if (attached) {
      const verb = creating ? 'Switched to a new branch' : 'Switched to branch'
      note += `${verb} '${target}'\n`
    } else {
      const { commit } = await git.readCommit({ ...repoArgs(repo), oid })
      const subject = commit.message.split('\n')[0] ?? ''
      note +=
        `Note: switching to '${target}'.\n\n${DETACHED_ADVICE}\n` +
        `HEAD is now at ${short(oid, repo.abbrev)} ${subject}\n`
    }
  } catch (err) {
    if (err instanceof GitError) return fatal(err)
    throw err
  }
  return [ENC.encode(carried), new IOResult({ stderr: ENC.encode(note) })]
}
