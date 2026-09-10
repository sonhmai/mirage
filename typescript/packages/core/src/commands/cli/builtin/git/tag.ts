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
import { identity } from './commit.ts'
import { HEAD } from './constants.ts'
import {
  GitError,
  IncompatibleOptionsError,
  InvalidTagNameError,
  MissingTagMessageError,
  NoWorkspaceError,
  TagExistsError,
  TagNotFoundError,
  TagUsageError,
  TooManyArgumentsError,
  UnknownSwitchError,
  UnresolvedRefError,
} from './errors.ts'
import { short } from './format.ts'
import { deleteRef, loadRefs, TAG_PREFIX, validRefName, writeRef } from './refs.ts'
import { opened, repoArgs, type Repo } from './repo.ts'
import { resolveCommit } from './revparse.ts'
import { checkOperands, fatal } from './util.ts'
import { fnmatch } from '../../../../utils/fnmatch.ts'
import { compareCodePoints } from '../../../../utils/sort.ts'

const ENC = new TextEncoder()
const DEC = new TextDecoder()
// git pads a tag name to this width before the message under -n.
const NAME_WIDTH = 15
const CONTINUATION = '    '

/** The parsed shape of a `git tag` invocation. */
interface TagFlags {
  /** `-l`, list tags, the operands being patterns. */
  readonly listing: boolean
  /** `-d`, delete the named tags. */
  readonly remove: boolean
  /** `-a`, write a tag object; implied by `-m`. */
  readonly annotate: boolean
  /** `-m`, the tag message. */
  readonly message: string | undefined
  /** `-f`, replace a tag that exists. */
  readonly force: boolean
  /**
   * `-n[<num>]`, how many message lines to print per tag when listing;
   * undefined when not listing that way.
   */
  readonly lines: number | undefined
}

/**
 * Read the raw tag flag kwargs into a frozen struct.
 *
 * `-n` carries its count attached or not at all, and a bare one means one line,
 * which is why the value is read as an integer first and only then as a
 * boolean. `-m` may repeat, each occurrence a paragraph of its own.
 */
function parseFlags(fl: FlagView): TagFlags {
  let lines = fl.asInt('n')
  if (lines === undefined && fl.asBool('n')) lines = 1
  // Several -m are several paragraphs, joined the way git joins them.
  const paragraphs = fl.asList('message')
  const message = paragraphs.length > 0 ? paragraphs.join('\n\n') : undefined
  return {
    listing: fl.asBool('list'),
    remove: fl.asBool('delete'),
    annotate: fl.asBool('annotate') || message !== undefined,
    message,
    force: fl.asBool('force'),
    lines,
  }
}

/** Every tag name the repository publishes, in git's listing order. */
export function tagNames(known: ReadonlyMap<string, string>): string[] {
  return [...known.keys()]
    .filter((ref) => ref.startsWith(TAG_PREFIX))
    .map((ref) => ref.slice(TAG_PREFIX.length))
    .sort(compareCodePoints)
}

/** The names a `-l` pattern list keeps: any pattern, or all. */
export function selectedNames(names: readonly string[], patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [...names]
  return names.filter((name) => patterns.some((pattern) => fnmatch(name, pattern)))
}

/**
 * The message `-n` prints for a tag: its own, or its commit's.
 *
 * An annotated tag carries a message; a lightweight one is a bare pointer, so
 * git shows the message of what it points at. Read off the raw object rather
 * than through isomorphic-git's tag parser, which normalizes away the blank
 * line an empty message leaves and then reads the headers as the message.
 */
async function messageLines(repo: Repo, oid: string): Promise<string[]> {
  // Deprecated upstream for being general, but the general answer is what
  // reading a tag and a commit the same way needs.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const { type, object } = await git.readObject({ ...repoArgs(repo), oid, format: 'content' })
  if (type !== 'tag' && type !== 'commit') return []
  const text = DEC.decode(object as Uint8Array)
  const cut = text.indexOf('\n\n')
  const lines = (cut === -1 ? '' : text.slice(cut + 2)).split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** One line per tag, with up to `count` message lines under -n. */
export function renderListing(
  names: readonly string[],
  messages: ReadonlyMap<string, readonly string[]> | null,
  count: number,
): string {
  const lines: string[] = []
  for (const name of names) {
    if (messages === null) {
      lines.push(name)
      continue
    }
    const body = (messages.get(name) ?? []).slice(0, count)
    lines.push(`${name.padEnd(NAME_WIDTH)} ${body[0] ?? ''}`)
    for (const line of body.slice(1)) lines.push(`${CONTINUATION}${line}`)
  }
  return lines.map((line) => `${line}\n`).join('')
}

/**
 * The object a new tag points at, and what kind it is.
 *
 * A tag made from another tag points at the tag object itself rather than at
 * what it peels to, which is git's own rule; anything else resolves as a
 * commit, ancestry suffixes included.
 */
async function resolveTarget(
  repo: Repo,
  known: ReadonlyMap<string, string>,
  revision: string,
): Promise<{ oid: string; type: 'commit' | 'tag' }> {
  const held = known.get(`${TAG_PREFIX}${revision}`)
  if (held !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const { type } = await git.readObject({ ...repoArgs(repo), oid: held })
    return { oid: held, type: type === 'tag' ? 'tag' : 'commit' }
  }
  try {
    return { oid: await resolveCommit(repo, revision), type: 'commit' }
  } catch {
    throw new UnresolvedRefError(revision)
  }
}

/**
 * Write an annotated tag object and return its id.
 *
 * Rendered by hand rather than through isomorphic-git's tag writer, which
 * appends a newline of its own after the message: git stores `-m x` as `x\n`
 * and an empty message as nothing at all, and the bytes decide the id.
 */
export async function buildTag(
  repo: Repo,
  name: string,
  target: { oid: string; type: string },
  message: string,
  tagger: string,
  when: number,
): Promise<string> {
  const body = message === '' ? '' : `${message}\n`
  const raw =
    `object ${target.oid}\ntype ${target.type}\ntag ${name}\n` +
    `tagger ${tagger} ${String(when)} +0000\n\n${body}`
  // Deprecated upstream in favour of writeTag, which is the writer whose extra
  // newline this exists to avoid.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return git.writeObject({
    ...repoArgs(repo),
    type: 'tag',
    object: ENC.encode(raw),
    format: 'content',
  })
}

/**
 * List, create or delete tags.
 *
 * No operand lists them, a name creates one, `-d` deletes. A bare name is a
 * lightweight tag, a pointer and nothing more; `-a` or `-m` writes a tag object
 * carrying a message and a tagger, and `-a` without `-m` is refused for the
 * reason `commit` refuses a missing message: there is no editor to open.
 */
export async function tag(inv: CLIInvocation): Promise<CommandFnResult> {
  const doors = inv.doors ?? {}
  const texts = [...inv.texts]
  const fl = new FlagView(inv.flags)
  let name: string
  let was: string | undefined
  let abbrev: number
  try {
    const dispatch = doors.dispatch
    if (dispatch === undefined) throw new NoWorkspaceError()
    checkOperands(texts, UnknownSwitchError)
    const flags = parseFlags(fl)
    if (flags.listing && flags.remove) throw new IncompatibleOptionsError('-l', '-d')
    // -a, -m and -f create a tag, so a line that lists or deletes instead has
    // nothing for them to do: git prints its usage and exits 129, where the
    // same line without them lists or deletes and exits 0. No operand at all is
    // a listing, which is why it counts here too.
    if (
      (flags.annotate || flags.force) &&
      (flags.listing || flags.remove || flags.lines !== undefined || texts.length === 0)
    ) {
      throw new TagUsageError()
    }
    const repo = await opened(fl, doors)
    abbrev = repo.abbrev
    const known = await loadRefs(dispatch, repo.location.gitdir, repo.location.commondir)
    if (flags.remove) {
      const out: string[] = []
      const err: string[] = []
      for (const each of texts) {
        const ref = `${TAG_PREFIX}${each}`
        const sha = known.get(ref)
        if (sha === undefined) {
          err.push(`error: ${new TagNotFoundError(each).message}\n`)
          continue
        }
        await deleteRef(dispatch, repo.location.commondir, ref)
        out.push(`Deleted tag '${each}' (was ${short(sha, repo.abbrev)})\n`)
      }
      return [
        ENC.encode(out.join('')),
        new IOResult({ exitCode: err.length > 0 ? 1 : 0, stderr: ENC.encode(err.join('')) }),
      ]
    }
    if (flags.listing || flags.lines !== undefined || texts.length === 0) {
      const names = selectedNames(tagNames(known), texts)
      let messages: Map<string, string[]> | null = null
      if (flags.lines !== undefined) {
        messages = new Map()
        for (const each of names) {
          messages.set(each, await messageLines(repo, known.get(`${TAG_PREFIX}${each}`) ?? ''))
        }
      }
      return [ENC.encode(renderListing(names, messages, flags.lines ?? 0)), new IOResult()]
    }
    if (texts.length > 2) throw new TooManyArgumentsError()
    name = texts[0] ?? ''
    if (!validRefName(name)) throw new InvalidTagNameError(name)
    const ref = `${TAG_PREFIX}${name}`
    was = known.get(ref)
    if (was !== undefined && !flags.force) throw new TagExistsError(name)
    if (flags.annotate && flags.message === undefined) throw new MissingTagMessageError()
    const target = await resolveTarget(repo, known, texts[1] ?? HEAD)
    let pointed = target.oid
    if (flags.annotate) {
      pointed = await buildTag(
        repo,
        name,
        target,
        flags.message ?? '',
        identity(fl, doors.sessionView).line,
        Math.floor(Date.now() / 1000),
      )
    }
    await writeRef(dispatch, repo.location.commondir, ref, pointed)
  } catch (err) {
    if (err instanceof GitError) return fatal(err)
    throw err
  }
  if (was === undefined) return [null, new IOResult()]
  return [ENC.encode(`Updated tag '${name}' (was ${short(was, abbrev)})\n`), new IOResult()]
}
