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
import { HEAD } from './constants.ts'

import { AmbiguousArgumentError } from './errors.ts'
import { TAG_PREFIX } from './refs.ts'
import { repoArgs, type Repo } from './repo.ts'
import type { AncestryStep, GitObject } from './types.ts'

const ANCESTOR = '~'
const PARENT = '^'
const SUFFIXES = [ANCESTOR, PARENT]
// `<rev>^{<type>}` peels to a type; `<rev>:<path>` reads a tree.
const PEEL_OPEN = '^{'
const PEEL_CLOSE = '}'
const PATH_MARK = ':'
export const COMMIT = 'commit'
export const TREE = 'tree'
export const TAG = 'tag'

/**
 * Split a trailing `^{<type>}` off a revision.
 *
 * `HEAD^{tree}` is a peel, not an ancestry step, and reading it as one is silent
 * rather than loud: `^` with no digits means "first parent", so the suffix
 * resolved to HEAD's parent commit and the caller was handed a different object
 * than it asked for without a word. The braces tell the two apart, and git
 * forbids both of them in a ref name, so nothing else can end this way.
 *
 * @param revision revision as the user spelled it
 * @returns the revision without the peel, and the type word inside it, empty for
 *   `^{}` and null when there is no peel at all
 */
function splitPeel(revision: string): [string, string | null] {
  if (!revision.endsWith(PEEL_CLOSE)) return [revision, null]
  const index = revision.lastIndexOf(PEEL_OPEN)
  if (index < 0) return [revision, null]
  return [revision.slice(0, index), revision.slice(index + PEEL_OPEN.length, -1)]
}

/**
 * Split a revision into its base and its ancestry suffixes.
 *
 * `HEAD~2^2` is a base plus two steps. Splitting on the first `~` or `^` is safe
 * because git forbids both characters in ref names, so neither can belong to the
 * base.
 *
 * @param revision revision as the user spelled it
 */
function splitRevision(revision: string): [string, AncestryStep[]] {
  let index = revision.length
  for (let i = 0; i < revision.length; i++) {
    if (SUFFIXES.includes(revision.charAt(i))) {
      index = i
      break
    }
  }
  const base = revision.slice(0, index)
  const rest = revision.slice(index)
  const steps: AncestryStep[] = []
  let position = 0
  while (position < rest.length) {
    const kind = rest.charAt(position)
    position += 1
    let digits = ''
    while (position < rest.length && /[0-9]/.test(rest.charAt(position))) {
      digits += rest.charAt(position)
      position += 1
    }
    steps.push({
      firstParent: kind === ANCESTOR,
      count: digits === '' ? 1 : Number.parseInt(digits, 10),
    })
  }
  return [base === '' ? HEAD : base, steps]
}

/** Load one commit's parents by object id, or report the revision as unknown. */
async function parentsOf(repo: Repo, oid: string, revision: string): Promise<string[]> {
  try {
    const { commit } = await git.readCommit({ ...repoArgs(repo), oid })
    return [...commit.parent]
  } catch {
    throw new AmbiguousArgumentError(revision)
  }
}

/**
 * Apply one ancestry suffix to a commit.
 *
 * `~n` walks n generations along first parents; `^n` takes the n-th parent of
 * this commit, and `^0` is the commit itself (git's way of spelling "the commit
 * a tag points at").
 */
async function applyStep(
  repo: Repo,
  oid: string,
  step: AncestryStep,
  revision: string,
): Promise<string> {
  let current = oid
  if (step.firstParent) {
    for (let i = 0; i < step.count; i++) {
      const parents = await parentsOf(repo, current, revision)
      const first = parents[0]
      if (first === undefined) throw new AmbiguousArgumentError(revision)
      current = first
    }
    return current
  }
  if (step.count === 0) return current
  const parents = await parentsOf(repo, current, revision)
  const picked = parents[step.count - 1]
  if (picked === undefined) throw new AmbiguousArgumentError(revision)
  return picked
}

/**
 * Resolve a revision to a commit id, ancestry suffixes included.
 *
 * isomorphic-git resolves refs, full ids and unambiguous short ids, and peels a
 * tag; it knows nothing about `~` and `^`, which are applied here on top of
 * whatever its own parser returns.
 *
 * A `^{}` or `^{commit}` peel asks for exactly what this returns and is
 * honoured; a peel naming any other type is a revision this caller cannot use,
 * so it is refused rather than quietly stripped.
 *
 * @param repo repository to resolve against
 * @param revision revision as the user spelled it
 */
export async function resolveCommit(repo: Repo, revision: string): Promise<string> {
  const [stem, want] = splitPeel(revision)
  if (want !== null && want !== '' && want !== COMMIT) throw new AmbiguousArgumentError(revision)
  const [base, steps] = splitRevision(stem)
  let oid: string
  try {
    oid = await git.resolveRef({ ...repoArgs(repo), ref: base })
  } catch {
    try {
      oid = await git.expandOid({ ...repoArgs(repo), oid: base })
    } catch {
      throw new AmbiguousArgumentError(revision)
    }
  }
  // A tag names a tag object, not the commit under it; peel until it is one.
  for (;;) {
    let type: string
    try {
      // Deprecated upstream for being general, but the general answer is
      // what peeling needs: which of commit/tag/tree/blob this id names,
      // without reading it as each in turn until one does not throw.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      type = (await git.readObject({ ...repoArgs(repo), oid })).type
    } catch {
      throw new AmbiguousArgumentError(revision)
    }
    if (type === 'commit') break
    if (type !== 'tag') throw new AmbiguousArgumentError(revision)
    oid = (await git.readTag({ ...repoArgs(repo), oid })).tag.object
  }
  for (const step of steps) {
    oid = await applyStep(repo, oid, step, revision)
  }
  return oid
}

/** The type isomorphic-git records for one object id. */
async function typeOf(repo: Repo, oid: string, revision: string): Promise<string> {
  try {
    // Deprecated upstream for being general, but the general answer is what
    // peeling needs: which of commit/tag/tree/blob this id names, without
    // reading it as each in turn until one does not throw.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return (await git.readObject({ ...repoArgs(repo), oid })).type
  } catch {
    throw new AmbiguousArgumentError(revision)
  }
}

/**
 * Follow a `^{<type>}` peel from the object the stem named.
 *
 * A tag is unwrapped until the type asked for is reached, which for `^{}` and
 * for every non-tag type means unwrapping it entirely. `^{tag}` is the one
 * spelling that stops before the first hop, so `v1^{tag}` is the tag object
 * itself rather than a refusal saying the commit behind it is no tag.
 * `^{tree}` then takes a commit's tree, git's one implicit step; every other
 * spelling has to already name the type it asks for, so `HEAD^{blob}` is
 * refused rather than answered with something else.
 *
 * A lightweight tag is still refused by `^{tag}`: the name resolves straight to
 * a commit, so there is no tag object to stop at and the type check below is
 * what says so.
 */
async function peeled(
  repo: Repo,
  found: GitObject,
  want: string,
  revision: string,
): Promise<GitObject> {
  let { oid, type } = found
  while (type === TAG && want !== TAG) {
    oid = (await git.readTag({ ...repoArgs(repo), oid })).tag.object
    type = await typeOf(repo, oid, revision)
  }
  if (want === '') return { oid, type }
  if (want === TREE && type === COMMIT) {
    oid = (await git.readCommit({ ...repoArgs(repo), oid })).commit.tree
    type = TREE
  }
  if (type !== want) throw new AmbiguousArgumentError(revision)
  return { oid, type }
}

/**
 * The object a `<rev>:<path>` names inside a tree.
 *
 * @param repo the opened repository
 * @param rev the revision before the colon, HEAD when empty
 * @param path the path after it, repository-relative
 * @param revision the whole revision, for error attribution
 */
async function atPath(repo: Repo, rev: string, path: string, revision: string): Promise<GitObject> {
  const holder = await resolveObject(repo, rev)
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const found = await git.readObject({ ...repoArgs(repo), oid: holder.oid, filepath: path })
    return { oid: found.oid, type: found.type }
  } catch {
    throw new AmbiguousArgumentError(revision)
  }
}

/**
 * The tag object a name or id denotes, null when it names no tag.
 *
 * Read before the stem is resolved, and only for `^{tag}`: every other peel type
 * sits at or below the commit, so unwrapping an annotated tag on the way is
 * git's own rule and costs nothing, while `^{tag}` is the one spelling that has
 * to stop above it. Resolving the stem the ordinary way cannot serve it, because
 * the commit-ish reading peels the tag before anything else sees it.
 *
 * Both spellings a tag answers to are tried, the ref and a raw id, and anything
 * that is not a tag object reads as no tag: a lightweight tag names a commit
 * directly, which is why git refuses `^{tag}` on one.
 */
async function tagObject(repo: Repo, stem: string): Promise<GitObject | null> {
  let oid: string
  try {
    oid = await git.resolveRef({ ...repoArgs(repo), ref: `${TAG_PREFIX}${stem}` })
  } catch {
    try {
      oid = await git.expandOid({ ...repoArgs(repo), oid: stem })
    } catch {
      return null
    }
  }
  let type: string
  try {
    type = await typeOf(repo, oid, stem)
  } catch {
    return null
  }
  return type === TAG ? { oid, type } : null
}

/**
 * The object a revision names, whatever type it turns out to be.
 *
 * The whole grammar a caller that wants an object rather than a commit has to
 * read: `HEAD:a.txt` is the blob at a path, `HEAD^{tree}` is a commit's tree,
 * `v1^{}` is what a tag points at, and a bare id of any type is itself. A
 * commit-ish is tried first because that is what the operand is normally spelled
 * with, and it is the only reading that understands ancestry.
 *
 * @param repo repository to resolve against
 * @param revision revision as the user spelled it
 */
export async function resolveObject(repo: Repo, revision: string): Promise<GitObject> {
  const mark = revision.indexOf(PATH_MARK)
  if (mark >= 0) {
    const rev = revision.slice(0, mark)
    return atPath(repo, rev === '' ? HEAD : rev, revision.slice(mark + 1), revision)
  }
  const [stem, want] = splitPeel(revision)
  if (want === null) {
    try {
      return { oid: await resolveCommit(repo, revision), type: COMMIT }
    } catch {
      // Not a commit-ish. A raw id is read as itself before the revision is
      // called unresolved, and the type is kept, since it is what a caller
      // records.
      const oid = await expanded(repo, revision)
      return { oid, type: await typeOf(repo, oid, revision) }
    }
  }
  if (want === TAG) {
    const found = await tagObject(repo, stem)
    if (found !== null) return found
  }
  return peeled(repo, await resolveObject(repo, stem), want, revision)
}

/** One id, full or abbreviated, expanded through the object store. */
async function expanded(repo: Repo, revision: string): Promise<string> {
  try {
    return await git.expandOid({ ...repoArgs(repo), oid: revision })
  } catch {
    throw new AmbiguousArgumentError(revision)
  }
}
