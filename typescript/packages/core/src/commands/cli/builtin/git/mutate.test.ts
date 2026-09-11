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

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { IOResult } from '../../../../io/types.ts'
import { OpsRegistry } from '../../../../ops/registry.ts'
import { RAMResource } from '../../../../resource/ram/ram.ts'
import { createShellParser, type ShellParser } from '../../../../shell/parse/index.ts'
import { MountMode } from '../../../../types.ts'
import { Workspace } from '../../../../workspace/workspace/workspace.ts'
import { GIT } from './index.ts'
import { ensureDir, readNames, readOptional } from './io.ts'
import type { Dispatch } from './types.ts'

const BUILDER = fileURLToPath(
  new URL('../../../../../../../../integ/fixtures/git/build.sh', import.meta.url),
)
const DEC = new TextDecoder()

const require = createRequire(import.meta.url)
const engineWasm = readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'))
const grammarWasm = readFileSync(require.resolve('tree-sitter-bash/tree-sitter-bash.wasm'))

let parser: ShellParser
let tmp: string
const roots: string[] = []

beforeAll(async () => {
  parser = await createShellParser({ engineWasm, grammarWasm })
  tmp = mkdtempSync(join(tmpdir(), 'mirage-git-mutate-'))
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function walkDisk(root: string, base = root): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) out.push(...walkDisk(full, base))
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

/** Every file under a mounted directory, as repository-relative paths. */
async function walkMount(dispatch: Dispatch, root: string, base = root): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readNames(dispatch, root)) {
    const name = entry.replace(/\/+$/, '').split('/').pop() ?? ''
    if (name === '') continue
    const full = `${root}/${name}`
    const data = await readOptional(dispatch, full)
    if (data === null) out.push(...(await walkMount(dispatch, full, base)))
    else out.push(full.slice(base.length + 1))
  }
  return out
}

interface Harness {
  ws: Workspace
  dispatch: Dispatch
  repo: string
  run(line: string): Promise<[number, string, string]>
  /** Copy the mount back to disk so the real binary can read what mirage wrote. */
  drain(): Promise<string>
}

/**
 * A workspace holding the fixture repository, copied into a RAM mount.
 *
 * `prepare` runs against the repository on disk, before the copy, so a test
 * needing a shape only the real binary can build (packed refs, an unmerged
 * index) starts from one git itself wrote rather than from bytes this file
 * hand-rolled.
 */
async function harness(prepare?: (repo: string) => void, nested?: string): Promise<Harness> {
  const repo = mkdtempSync(join(tmp, 'repo-'))
  roots.push(repo)
  execFileSync('bash', [BUILDER, repo], { stdio: 'ignore' })
  prepare?.(repo)

  const ram = new RAMResource()
  const registry = new OpsRegistry()
  registry.registerResource(ram)
  // `nested` mounts a second resource inside the repository, which is the
  // one shape a verb cannot rename: its keys live in another resource, so
  // the backend holding the parent path cannot carry them along.
  const mounts: Record<string, RAMResource> = { '/repo': ram }
  if (nested !== undefined) {
    const child = new RAMResource()
    registry.registerResource(child)
    mounts[nested] = child
  }
  const ws = new Workspace(mounts, {
    mode: MountMode.WRITE,
    ops: registry,
    shellParser: parser,
  })
  const dispatch: Dispatch = async (op, path, args = [], kwargs = {}) => [
    await ws.dispatch(op, path.virtual, args, kwargs),
    new IOResult(),
  ]
  // A mount's ancestors read as existing directories the moment the child is
  // mounted, so `ensureDir` stops at one and the parent backend never gets the
  // key. Created directly here, before anything is copied in.
  if (nested !== undefined) {
    const parts = nested.slice('/repo/'.length).split('/').slice(0, -1)
    for (let n = 1; n <= parts.length; n += 1) {
      await ws.dispatch('mkdir', `/repo/${parts.slice(0, n).join('/')}`)
    }
  }
  for (const rel of walkDisk(repo)) {
    const target = `/repo/${rel}`
    await ensureDir(dispatch, target.slice(0, target.lastIndexOf('/')))
    await ws.dispatch('write', target, [new Uint8Array(readFileSync(join(repo, rel)))])
    await ws.dispatch('setattr', target, [], { mode: statSync(join(repo, rel)).mode })
  }
  ws.registerCli('git', GIT)

  return {
    ws,
    dispatch,
    repo,
    async run(line: string) {
      const result = await ws.execute(`git -C /repo ${line}`)
      return [result.exitCode, DEC.decode(result.stdout), DEC.decode(result.stderr)]
    },
    async drain() {
      // The real binary is the reader of record: a mutation that produced a
      // repository git itself cannot make sense of has not worked, however
      // plausible mirage's own status output looks.
      const out = mkdtempSync(join(tmp, 'drain-'))
      roots.push(out)
      for (const rel of await walkMount(dispatch, '/repo')) {
        const data = await readOptional(dispatch, `/repo/${rel}`)
        if (data === null) continue
        mkdirSync(dirname(join(out, rel)), { recursive: true })
        writeFileSync(join(out, rel), data)
      }
      return out
    },
  }
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** Leave one staged path unmerged, its stages all holding the blob it has. */
function conflictIndex(repo: string, path: string, stages: number[] = [1, 2, 3]): void {
  const blob = git(repo, ['rev-parse', `:${path}`]).trim()
  // A merge replaces the stage-0 entry rather than sitting beside it, and
  // `--index-info` removes one only when told to, so the zero id goes first.
  // Left in, the path reads as staged and unmerged at once, which is a state
  // no merge produces and which hides every refusal that reads stage 0.
  const lines = [
    `0 ${'0'.repeat(40)}\t${path}`,
    ...stages.map((stage) => `100644 ${blob} ${String(stage)}\t${path}`),
  ]
  execFileSync('git', ['-C', repo, 'update-index', '--index-info'], {
    input: `${lines.join('\n')}\n`,
  })
}

/** Write into the mount, which is where the verbs under test read from. */
async function write(h: Harness, path: string, text: string): Promise<void> {
  const target = `/repo/${path}`
  await ensureDir(h.dispatch, target.slice(0, target.lastIndexOf('/')))
  await h.ws.dispatch('write', target, [new TextEncoder().encode(text)])
}

/** Make a branch that holds one file main does not, then leave it. */
async function branchHolding(h: Harness, name: string, path: string, text: string): Promise<void> {
  await h.run(`checkout -b ${name}`)
  await write(h, path, text)
  await h.run('add -A')
  await h.run(`commit -m ${name}`)
  await h.run('checkout main')
}

describe('git add', () => {
  it('stages an edit, and the real binary agrees', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('add -A')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('M  letters.txt\n')
  })

  it('stages a new file', async () => {
    const h = await harness()
    await write(h, 'fresh.txt', 'x\n')
    await h.run('add fresh.txt')
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('A  fresh.txt\n')
  })

  it('stages a deletion', async () => {
    const h = await harness()
    await h.ws.dispatch('unlink', '/repo/numbers.txt')
    await h.run('add -A')
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('D  numbers.txt\n')
  })

  it('refuses an ignored path named outright', async () => {
    const h = await harness()
    await write(h, '.gitignore', '*.log\n')
    await write(h, 'debug.log', 'x\n')
    const [code, , err] = await h.run('add debug.log')
    expect(code).toBe(1)
    expect(err.startsWith('The following paths are ignored by one of your .gitignore')).toBe(true)
  })

  it('stages an ignored path under -f', async () => {
    const h = await harness()
    await write(h, '.gitignore', '*.log\n')
    await write(h, 'debug.log', 'x\n')
    expect((await h.run('add -f debug.log'))[0]).toBe(0)
    expect(git(await h.drain(), ['status', '--porcelain'])).toContain('A  debug.log')
  })

  it('says what it did not do with no pathspec', async () => {
    const h = await harness()
    const [code, , err] = await h.run('add')
    expect(code).toBe(0)
    expect(err.startsWith('Nothing specified, nothing added.')).toBe(true)
  })

  it('under -u stages only what the pathspec covers', async () => {
    // Without the pathspec this restages every tracked file, which is how
    // an unrelated edit ends up in the next commit.
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await write(h, 'docs/readme.md', 'edited\n')
    expect(await h.run('add -u docs')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['diff', '--cached', '--name-only'])).toBe('docs/readme.md\n')
  })

  it('under -u stages a removal only under the pathspec', async () => {
    const h = await harness()
    await h.ws.dispatch('unlink', '/repo/letters.txt')
    await h.ws.dispatch('unlink', '/repo/docs/readme.md')
    await h.run('add -u docs')
    const drained = await h.drain()
    expect(git(drained, ['diff', '--cached', '--name-only'])).toBe('docs/readme.md\n')
  })

  it('under -u refuses a pathspec that names nothing', async () => {
    const h = await harness()
    const [code, , err] = await h.run('add -u nosuch')
    expect(code).toBe(128)
    expect(err).toBe("fatal: pathspec 'nosuch' did not match any files\n")
  })

  it('under -u refuses a pathspec that names only an untracked file', async () => {
    // It is there, so the pathspec is not the problem: -u restages what the
    // index holds, and the index has never heard of this one.
    const h = await harness()
    await write(h, 'fresh.txt', 'x\n')
    const [code, , err] = await h.run('add -u fresh.txt')
    expect(code).toBe(128)
    expect(err).toBe("error: pathspec 'fresh.txt' did not match any file(s) known to git\n")
  })

  it('refuses a pathspec that matches nothing', async () => {
    const h = await harness()
    const [code, , err] = await h.run('add nosuch.txt')
    expect(code).toBe(128)
    expect(err).toBe("fatal: pathspec 'nosuch.txt' did not match any files\n")
  })
})

describe('git reset', () => {
  it('unstages an edit but keeps it in the working tree', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await h.run('add -A')
    const [code, out] = await h.run('reset')
    expect(code).toBe(0)
    expect(out).toBe('Unstaged changes after reset:\nM\tletters.txt\n')
    const drained = await h.drain()
    expect(git(drained, ['status', '--porcelain'])).toBe(' M letters.txt\n')
    expect(readFileSync(join(drained, 'letters.txt'), 'utf8')).toBe('edited\n')
  })

  it('says nothing on a clean tree', async () => {
    const h = await harness()
    expect(await h.run('reset')).toEqual([0, '', ''])
  })

  it('turns a staged new file back into an untracked one', async () => {
    const h = await harness()
    await write(h, 'fresh.txt', 'x\n')
    await h.run('add -A')
    await h.run('reset')
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('?? fresh.txt\n')
  })

  it('unstages only the named path', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await write(h, 'numbers.txt', 'also edited\n')
    await h.run('add -A')
    await h.run('reset letters.txt')
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe(' M letters.txt\nM  numbers.txt\n')
  })

  it('refuses a pathspec that matches nothing', async () => {
    // Selecting nothing used to unstage nothing and exit 0, which reads to a
    // script as "the index was reset".
    const h = await harness()
    const [code, , err] = await h.run('reset nosuch.txt')
    expect(code).toBe(128)
    expect(err).toBe(
      "fatal: ambiguous argument 'nosuch.txt': unknown revision or path not " +
        "in the working tree.\nUse '--' to separate paths from revisions, " +
        "like this:\n'git <command> [<revision>...] -- [<file>...]'\n",
    )
  })

  it('says which feature is missing for a revision operand', async () => {
    // Real git resets the index to the named commit. This build does not, and
    // "unknown revision" would be a lie about a revision it resolves.
    const h = await harness()
    const [code, , err] = await h.run('reset HEAD~1')
    expect(code).toBe(128)
    expect(err).toBe(
      "fatal: cannot reset to 'HEAD~1': this build resets the index from HEAD only\n",
    )
  })
})

describe('git commit', () => {
  it('records the index, and git reads the commit back', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await h.run('add -A')
    const [code, out] = await h.run("commit -m 'a change'")
    expect(code).toBe(0)
    expect(out).toMatch(/^\[main [0-9a-f]{7}] a change\n/)
    const drained = await h.drain()
    expect(git(drained, ['log', '--format=%s', '-1'])).toBe('a change\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })

  it('reports the diffstat git reports', async () => {
    const h = await harness()
    await write(h, 'fresh.txt', 'one\ntwo\n')
    await h.run('add -A')
    const [, out] = await h.run("commit -m 'add fresh'")
    expect(out).toContain(' 1 file changed, 2 insertions(+)')
    expect(out).toContain(' create mode 100644 fresh.txt')
  })

  it('counts a binary file as changed but zero lines, like git', async () => {
    // Pinned against git 2.37: NUL in the first 8000 bytes makes the blob
    // binary, and binary blobs contribute files but never line counts.
    const h = await harness()
    await h.ws.dispatch('write', '/repo/blob.bin', [new Uint8Array([65, 0, 66, 0, 67])])
    await h.run('add -A')
    const [, out] = await h.run("commit -m 'add binary'")
    expect(out).toContain(' 1 file changed, 0 insertions(+), 0 deletions(-)')
    expect(out).toContain(' create mode 100644 blob.bin')
  })

  it('drops the deletions clause in a mixed text and binary commit', async () => {
    const h = await harness()
    await write(h, 'text.txt', 'x\ny\nz\n')
    await h.ws.dispatch('write', '/repo/blob.bin', [new Uint8Array([68, 0, 69])])
    await h.run('add -A')
    const [, out] = await h.run("commit -m 'mixed'")
    expect(out).toContain(' 2 files changed, 3 insertions(+)\n')
  })

  it('refuses without a message', async () => {
    const h = await harness()
    const [code, , err] = await h.run('commit')
    expect(code).toBe(128)
    expect(err).toBe('fatal: no commit message supplied (mirage has no editor to open; pass -m)\n')
  })

  it('prints the status report when there is nothing to commit', async () => {
    const h = await harness()
    const [code, out] = await h.run("commit -m 'nothing'")
    expect(code).toBe(1)
    expect(out).toBe('On branch main\nnothing to commit, working tree clean\n')
  })

  it('honours --author', async () => {
    const h = await harness()
    await write(h, 'fresh.txt', 'x\n')
    await h.run('add -A')
    await h.run("commit -m 'authored' --author 'Someone <someone@example.com>'")
    expect(git(await h.drain(), ['log', '--format=%an <%ae>', '-1'])).toBe(
      'Someone <someone@example.com>\n',
    )
  })

  it('commits a nested path so the tree nests', async () => {
    const h = await harness()
    await write(h, 'deep/inner/leaf.txt', 'x\n')
    await h.run('add -A')
    await h.run("commit -m 'nested'")
    const drained = await h.drain()
    expect(git(drained, ['ls-tree', '-r', '--name-only', 'HEAD'])).toContain('deep/inner/leaf.txt')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })
})

describe('git checkout', () => {
  it('switches branches and moves the working tree', async () => {
    const h = await harness()
    const [code, , err] = await h.run('checkout topic')
    expect(code).toBe(0)
    expect(err).toBe("Switched to branch 'topic'\n")
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('topic\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })

  it('says so when already there', async () => {
    const h = await harness()
    expect((await h.run('checkout main'))[2]).toBe("Already on 'main'\n")
  })

  it('creates and switches in one step', async () => {
    const h = await harness()
    const [code, , err] = await h.run('checkout -b shiny')
    expect(code).toBe(0)
    expect(err).toBe("Switched to a new branch 'shiny'\n")
    expect(git(await h.drain(), ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('shiny\n')
  })

  it('refuses to create one that exists', async () => {
    const h = await harness()
    const [code, , err] = await h.run('checkout -b topic')
    expect(code).toBe(128)
    expect(err).toBe("fatal: a branch named 'topic' already exists\n")
  })

  it('refuses an unknown target', async () => {
    const h = await harness()
    const [code, , err] = await h.run('checkout nosuchthing')
    expect(code).toBe(1)
    expect(err).toBe("error: pathspec 'nosuchthing' did not match any file(s) known to git\n")
  })

  it('creates at a start point when one is given', async () => {
    // The operand is the whole point of the form: without it every commit
    // after the switch lands on the wrong history.
    const h = await harness()
    const older = git(h.repo, ['rev-parse', 'HEAD~1']).trim()
    const [code, , err] = await h.run('checkout -b older HEAD~1')
    expect(code).toBe(0)
    expect(err).toBe("Switched to a new branch 'older'\n")
    expect(git(await h.drain(), ['rev-parse', 'older']).trim()).toBe(older)
  })

  it('creates at HEAD when no start point is given', async () => {
    const h = await harness()
    const head = git(h.repo, ['rev-parse', 'HEAD']).trim()
    expect((await h.run('checkout -b shiny'))[0]).toBe(0)
    expect(git(await h.drain(), ['rev-parse', 'shiny']).trim()).toBe(head)
  })

  it('refuses a start point that is not a commit', async () => {
    const h = await harness()
    const [code, , err] = await h.run('checkout -b shiny nosuchrev')
    expect(code).toBe(128)
    expect(err).toBe(
      "fatal: 'nosuchrev' is not a commit and a branch 'shiny' cannot be created from it\n",
    )
  })

  it('refuses a switch that would overwrite an edit', async () => {
    const h = await harness()
    // topic is HEAD~1, where numbers.txt reads differently.
    await write(h, 'numbers.txt', 'precious\n')
    const [code, , err] = await h.run('checkout topic')
    expect(code).toBe(1)
    expect(err).toContain('would be overwritten by checkout')
    expect(err).toContain('\tnumbers.txt')
    const drained = await h.drain()
    // The point of the refusal: the edit is still there.
    expect(readFileSync(join(drained, 'numbers.txt'), 'utf8')).toBe('precious\n')
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main\n')
  })

  it('carries an edit to a file both branches agree on', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'carried\n')
    const [code, out] = await h.run('checkout topic')
    expect(code).toBe(0)
    expect(out).toBe('M\tletters.txt\n')
    expect(readFileSync(join(await h.drain(), 'letters.txt'), 'utf8')).toBe('carried\n')
  })

  it('detaches HEAD onto a commit', async () => {
    const h = await harness()
    const older = git(h.repo, ['rev-parse', 'HEAD~1']).trim()
    const [code, , err] = await h.run(`checkout ${older.slice(0, 7)}`)
    expect(code).toBe(0)
    expect(err).toContain('detached HEAD')
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', 'HEAD']).trim()).toBe(older)
    // The reflog is what makes `git branch` say where it detached from rather
    // than "(no branch)".
    expect(git(drained, ['branch'])).toContain('detached at')
  })

  it('leaves an untracked file alone', async () => {
    const h = await harness()
    await write(h, 'mine.txt', 'untracked\n')
    expect((await h.run('checkout topic'))[0]).toBe(0)
    expect(readFileSync(join(await h.drain(), 'mine.txt'), 'utf8')).toBe('untracked\n')
  })

  it('refuses a switch that would overwrite an untracked file', async () => {
    // The dangerous one: the file is in no index and no tree, so the tracked
    // comparison cannot see it, and writing the branch's blob over it
    // destroys the only copy there is.
    const h = await harness()
    await branchHolding(h, 'side', 'fresh.txt', 'branch\n')
    await write(h, 'fresh.txt', 'mine\n')
    const [code, , err] = await h.run('checkout side')
    expect(code).toBe(1)
    expect(err).toBe(
      'error: The following untracked working tree files would be overwritten ' +
        'by checkout:\n\tfresh.txt\nPlease move or remove them before you ' +
        'switch branches.\nAborting\n',
    )
    const drained = await h.drain()
    expect(readFileSync(join(drained, 'fresh.txt'), 'utf8')).toBe('mine\n')
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main\n')
  })

  it('names the untracked file inside a wholly untracked directory', async () => {
    // Status collapses such a directory to one `dir/` row, and a collision
    // has to be decided per file. git names the file.
    const h = await harness()
    await branchHolding(h, 'side', 'nd/file.txt', 'branch\n')
    await write(h, 'nd/file.txt', 'mine\n')
    await write(h, 'nd/other.txt', 'also\n')
    const [code, , err] = await h.run('checkout side')
    expect(code).toBe(1)
    expect(err).toContain('\tnd/file.txt')
    expect(readFileSync(join(await h.drain(), 'nd/file.txt'), 'utf8')).toBe('mine\n')
  })

  it('overwrites an ignored file without a word', async () => {
    // git's own split: an ignored file is not work the caller is keeping.
    const h = await harness()
    await h.run('checkout -b side')
    await write(h, 'ig.txt', 'branch\n')
    await h.run('add -f ig.txt')
    await h.run('commit -m ignored')
    await h.run('checkout main')
    await write(h, '.gitignore', 'ig.txt\n')
    await write(h, 'ig.txt', 'mine\n')
    expect((await h.run('checkout side'))[0]).toBe(0)
    expect(readFileSync(join(await h.drain(), 'ig.txt'), 'utf8')).toBe('branch\n')
  })

  it('reports both kinds of conflict before one abort', async () => {
    const h = await harness()
    await h.run('checkout -b side')
    await write(h, 'letters.txt', 'onthebranch\n')
    await write(h, 'fresh.txt', 'branch\n')
    await h.run('add -A')
    await h.run('commit -m both')
    await h.run('checkout main')
    await write(h, 'letters.txt', 'precious\n')
    await write(h, 'fresh.txt', 'mine\n')
    const [code, , err] = await h.run('checkout side')
    expect(code).toBe(1)
    expect(err).toBe(
      'error: Your local changes to the following files would be overwritten ' +
        'by checkout:\n\tletters.txt\nPlease commit your changes or stash them ' +
        'before you switch branches.\n' +
        'error: The following untracked working tree files would be overwritten ' +
        'by checkout:\n\tfresh.txt\nPlease move or remove them before you ' +
        'switch branches.\nAborting\n',
    )
  })
})

describe('git branch -d', () => {
  it('refuses a branch HEAD does not contain', async () => {
    // The branch name is the only thing pointing at that commit, so -d
    // would be the command that loses it.
    const h = await harness()
    await branchHolding(h, 'side', 'fresh.txt', 'branch\n')
    const [code, out, err] = await h.run('branch -d side')
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(err).toBe(
      "error: the branch 'side' is not fully merged\nhint: If you are sure " +
        "you want to delete it, run 'git branch -D side'\n",
    )
    expect(git(await h.drain(), ['branch'])).toContain('side')
  })

  it('deletes it under -D', async () => {
    const h = await harness()
    await branchHolding(h, 'side', 'fresh.txt', 'branch\n')
    const [code, out] = await h.run('branch -D side')
    expect(code).toBe(0)
    expect(out.startsWith('Deleted branch side (was ')).toBe(true)
    expect(git(await h.drain(), ['branch'])).not.toContain('side')
  })

  it('allows a branch behind HEAD', async () => {
    // Merged does not mean equal: an ancestor of HEAD is contained in it,
    // so nothing is lost by dropping the name. `topic` is HEAD~1.
    const h = await harness()
    const [code, out] = await h.run('branch -d topic')
    expect(code).toBe(0)
    expect(out.startsWith('Deleted branch topic (was ')).toBe(true)
  })
})

describe('a full round trip', () => {
  it('edits, stages, commits and switches, with git agreeing at the end', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'alpha\nbeta\ngamma\ndelta\nepsilon\n')
    await write(h, 'notes/todo.md', '- one\n')
    await h.run('add -A')
    await h.run("commit -m 'work in progress'")
    await h.run('checkout -b feature')
    await write(h, 'notes/todo.md', '- one\n- two\n')
    await h.run('add -A')
    await h.run("commit -m 'more notes'")
    const drained = await h.drain()
    expect(git(drained, ['log', '--format=%s'])).toBe(
      [
        'more notes',
        'work in progress',
        'add two',
        'add docs',
        'add delta',
        'first commit',
        '',
      ].join('\n'),
    )
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
    expect(git(drained, ['fsck', '--no-progress'])).toBe('')
  })
})

describe('the fixture repository', () => {
  it('is left byte-identical when nothing is asked of it', async () => {
    // A read-only verb must not rewrite anything: an index touched on the way
    // past would make every later comparison meaningless.
    const h = await harness()
    await h.run('status')
    await h.run('log --oneline')
    const drained = await h.drain()
    for (const rel of walkDisk(h.repo)) {
      expect([rel, readFileSync(join(drained, rel))]).toEqual([
        rel,
        readFileSync(join(h.repo, rel)),
      ])
    }
  })
})

describe('symlinks', () => {
  it('stages a link as 120000 holding its target, not the target content', async () => {
    // Pinned against git 2.50, and read back by the real binary: the blob is
    // the target string. Reading through the link would store a second copy
    // of numbers.txt under mode 100644, which is a file, not a link.
    const h = await harness()
    await h.ws.execute('ln -s numbers.txt /repo/link')
    expect((await h.run('add link'))[0]).toBe(0)
    expect((await h.run('commit -m linked'))[0]).toBe(0)
    const out = await h.drain()
    expect(git(out, ['ls-files', '-s'])).toContain('120000')
    expect(git(out, ['cat-file', '-p', 'HEAD:link'])).toBe('numbers.txt')
  })

  it('finds a broken link the backend stat cannot see', async () => {
    // git lstats, so a link to nothing is untracked like any other entry; a
    // dereferencing stat answers null and loses it entirely.
    const h = await harness()
    await h.ws.execute('ln -s nowhere /repo/broken')
    const [, out] = await h.run('status --porcelain')
    expect(out).toContain('?? broken')
  })

  it('reports the symlink mode in the commit summary', async () => {
    const h = await harness()
    await h.ws.execute('ln -s numbers.txt /repo/link')
    expect((await h.run('add link'))[0]).toBe(0)
    const [, out] = await h.run('commit -m linked')
    expect(out).toContain(' create mode 120000 link')
  })

  it('leaves a staged link unmodified rather than always dirty', async () => {
    const h = await harness()
    await h.ws.execute('ln -s numbers.txt /repo/link')
    expect((await h.run('add link'))[0]).toBe(0)
    const [, out] = await h.run('status --porcelain')
    expect(out).toBe('A  link\n')
  })

  it('restores a checked-out link as a link, not as a file of its target', async () => {
    // The name plane owns links, so restoring one is a namespace write rather
    // than a content write.
    const h = await harness()
    expect((await h.run('checkout -b side'))[0]).toBe(0)
    await h.ws.execute('ln -s numbers.txt /repo/link')
    expect((await h.run('add link'))[0]).toBe(0)
    expect((await h.run('commit -m linked'))[0]).toBe(0)
    expect((await h.run('checkout main'))[0]).toBe(0)
    expect((await h.run('checkout side'))[0]).toBe(0)
    const listing = await h.ws.execute('ls -l /repo/link')
    expect(DEC.decode(listing.stdout)).toContain('link -> numbers.txt')
  })

  it('retargets a link the other branch points elsewhere', async () => {
    // symlink(2) does not overwrite, so the checkout removes the old name
    // before writing the new one. Relying on the node table to replace the
    // entry in place left the checkout refused with EEXIST and the link
    // pointing at the other branch's target.
    const h = await harness()
    expect((await h.run('checkout -b first'))[0]).toBe(0)
    await h.ws.execute('ln -s numbers.txt /repo/lk')
    expect((await h.run('add lk'))[0]).toBe(0)
    expect((await h.run('commit -m first'))[0]).toBe(0)
    expect((await h.run('checkout -b second'))[0]).toBe(0)
    await write(h, 'other.txt', 'other\n')
    await h.ws.execute('ln -sf other.txt /repo/lk')
    expect((await h.run('add -A'))[0]).toBe(0)
    expect((await h.run('commit -m second'))[0]).toBe(0)
    expect((await h.run('checkout first'))[0]).toBe(0)
    expect(DEC.decode((await h.ws.execute('readlink /repo/lk')).stdout)).toBe('numbers.txt\n')
    expect((await h.run('checkout second'))[0]).toBe(0)
    expect(DEC.decode((await h.ws.execute('readlink /repo/lk')).stdout)).toBe('other.txt\n')
  })

  it('replaces a link with the regular file the other branch records', async () => {
    // git 2.47: a path that is a symlink on one branch and a regular file on
    // the other comes back as a regular file, and the file the link pointed at
    // keeps its own content. Writing through the link instead dereferences it:
    // the blob lands in numbers.txt, which no branch ever changed, and the link
    // stays in the working tree while HEAD and the index say a file is there.
    const h = await harness()
    expect((await h.run('checkout -b linked'))[0]).toBe(0)
    await h.ws.execute('ln -s numbers.txt /repo/thing')
    expect((await h.run('add thing'))[0]).toBe(0)
    expect((await h.run('commit -m link'))[0]).toBe(0)
    expect((await h.run('checkout -b plain'))[0]).toBe(0)
    await h.ws.execute('rm /repo/thing')
    await write(h, 'thing', 'PLAIN\n')
    expect((await h.run('add thing'))[0]).toBe(0)
    expect((await h.run('commit -m plain'))[0]).toBe(0)
    expect((await h.run('checkout linked'))[0]).toBe(0)
    expect((await h.run('checkout plain'))[0]).toBe(0)
    const listing = await h.ws.execute('ls -l /repo/thing')
    expect(DEC.decode(listing.stdout).startsWith('lrwxrwxrwx')).toBe(false)
    const content = await h.ws.execute('cat /repo/thing')
    expect(DEC.decode(content.stdout)).toBe('PLAIN\n')
    const kept = await h.ws.execute('cat /repo/numbers.txt')
    expect(DEC.decode(kept.stdout)).not.toContain('PLAIN')
  })

  it('replaces a regular file with the link the other branch records', async () => {
    // The mirror: the file must not survive under the link it was replaced by,
    // or removing the link later uncovers content no branch records.
    const h = await harness()
    expect((await h.run('checkout -b plainfirst'))[0]).toBe(0)
    await write(h, 'thing', 'PLAIN\n')
    expect((await h.run('add thing'))[0]).toBe(0)
    expect((await h.run('commit -m plain'))[0]).toBe(0)
    expect((await h.run('checkout -b linkedafter'))[0]).toBe(0)
    await h.ws.execute('rm /repo/thing')
    await h.ws.execute('ln -s numbers.txt /repo/thing')
    expect((await h.run('add thing'))[0]).toBe(0)
    expect((await h.run('commit -m link'))[0]).toBe(0)
    expect((await h.run('checkout plainfirst'))[0]).toBe(0)
    expect((await h.run('checkout linkedafter'))[0]).toBe(0)
    await h.ws.execute('rm /repo/thing')
    const listing = await h.ws.execute('ls /repo/thing')
    expect(DEC.decode(listing.stderr)).toContain('No such file or directory')
  })
})

describe('commit identity', () => {
  it('takes the author from the environment', async () => {
    // Real git reads GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL ahead of any config,
    // and there is no config file behind a mount.
    const h = await harness()
    await write(h, 'numbers.txt', 'changed\n')
    expect((await h.run('add -A'))[0]).toBe(0)
    const result = await h.ws.execute(
      'GIT_AUTHOR_NAME=Ada GIT_AUTHOR_EMAIL=ada@x git -C /repo commit -m env',
    )
    expect(result.exitCode).toBe(0)
    const out = await h.drain()
    expect(git(out, ['log', '-1', '--format=%an <%ae>'])).toBe('Ada <ada@x>\n')
  })

  it('falls back to EMAIL for the address', async () => {
    const h = await harness()
    await write(h, 'numbers.txt', 'changed\n')
    expect((await h.run('add -A'))[0]).toBe(0)
    const result = await h.ws.execute(
      'GIT_AUTHOR_NAME=Ada EMAIL=ada@fallback git -C /repo commit -m env',
    )
    expect(result.exitCode).toBe(0)
    const out = await h.drain()
    expect(git(out, ['log', '-1', '--format=%an <%ae>'])).toBe('Ada <ada@fallback>\n')
  })

  it('keeps the stated default when the environment names nobody', async () => {
    const h = await harness()
    await write(h, 'numbers.txt', 'changed\n')
    expect((await h.run('add -A'))[0]).toBe(0)
    expect((await h.run('commit -m plain'))[0]).toBe(0)
    const out = await h.drain()
    expect(git(out, ['log', '-1', '--format=%an <%ae>'])).toBe('mirage <mirage@localhost>\n')
  })
})

describe('git switch', () => {
  it('moves to a branch and the real binary agrees on HEAD', async () => {
    const h = await harness()
    expect(await h.run('switch topic')).toEqual([0, '', "Switched to branch 'topic'\n"])
    expect(git(await h.drain(), ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('topic\n')
  })

  it('says so when already there', async () => {
    const h = await harness()
    expect(await h.run('switch main')).toEqual([0, '', "Already on 'main'\n"])
  })

  it('creates with -c at a start point', async () => {
    const h = await harness()
    expect(await h.run('switch -c older HEAD~1')).toEqual([
      0,
      '',
      "Switched to a new branch 'older'\n",
    ])
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', 'older'])).toBe(git(drained, ['rev-parse', 'main~1']))
  })

  it('words an unknown name as an invalid reference', async () => {
    const h = await harness()
    expect(await h.run('switch nosuch')).toEqual([128, '', 'fatal: invalid reference: nosuch\n'])
  })

  it('refuses a bare commit without --detach', async () => {
    const h = await harness()
    const [code, , err] = await h.run('switch 265ec3a')
    expect(code).toBe(128)
    expect(err).toBe(
      "fatal: a branch is expected, got commit '265ec3a'\n" +
        'hint: If you want to detach HEAD at the commit, try again with the --detach option.\n',
    )
  })

  it('detaches under --detach and names the previous position on the way back', async () => {
    const h = await harness()
    expect(await h.run('switch --detach HEAD~1')).toEqual([
      0,
      '',
      'HEAD is now at 225f39c add docs\n',
    ])
    expect(await h.run('switch main')).toEqual([
      0,
      '',
      "Previous HEAD position was 225f39c add docs\nSwitched to branch 'main'\n",
    ])
  })

  it('refuses a switch that would overwrite an edit', async () => {
    const h = await harness()
    await write(h, 'numbers.txt', 'precious\n')
    const [code, , err] = await h.run('switch topic')
    expect(code).toBe(1)
    expect(err.startsWith('error: Your local changes to the following files')).toBe(true)
  })

  it('needs exactly one operand', async () => {
    const h = await harness()
    expect(await h.run('switch')).toEqual([128, '', 'fatal: missing branch or commit argument\n'])
    expect(await h.run('switch main topic')).toEqual([
      128,
      '',
      'fatal: only one reference expected\n',
    ])
  })
})

describe('git restore', () => {
  it('puts a worktree edit back', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('restore letters.txt')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('')
  })

  it('unstages under --staged and keeps the edit', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await h.run('add letters.txt')
    expect(await h.run('restore --staged letters.txt')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe(' M letters.txt\n')
  })

  it('restores both targets under -SW', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await h.run('add letters.txt')
    await write(h, 'letters.txt', 'again\n')
    expect(await h.run('restore -SW letters.txt')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(drained, 'letters.txt'), 'utf8')).toBe('alpha\nbeta\ngamma\ndelta\n')
  })

  it('restores from --source', async () => {
    const h = await harness()
    expect(await h.run('restore --source HEAD~3 numbers.txt')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(readFileSync(join(drained, 'numbers.txt'), 'utf8')).toBe('one\n')
    expect(git(drained, ['status', '--porcelain'])).toBe(' M numbers.txt\n')
  })

  it('removes a path the source lacks from both targets', async () => {
    const h = await harness()
    expect(await h.run('restore -s HEAD~3 -SW docs/readme.md')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('D  docs/readme.md\n')
  })

  it('words an unknown path as an error, not a fatal', async () => {
    const h = await harness()
    expect(await h.run('restore nosuch')).toEqual([
      1,
      '',
      "error: pathspec 'nosuch' did not match any file(s) known to git\n",
    ])
  })

  it('needs a pathspec', async () => {
    const h = await harness()
    expect(await h.run('restore')).toEqual([
      128,
      '',
      'fatal: you must specify path(s) to restore\n',
    ])
  })

  it('refuses a source it cannot resolve', async () => {
    const h = await harness()
    expect(await h.run('restore -s nosuch letters.txt')).toEqual([
      128,
      '',
      'fatal: could not resolve nosuch\n',
    ])
  })
})

describe('git rm', () => {
  it('stages a deletion and removes the file', async () => {
    const h = await harness()
    expect(await h.run('rm letters.txt')).toEqual([0, "rm 'letters.txt'\n", ''])
    const drained = await h.drain()
    expect(git(drained, ['status', '--porcelain'])).toBe('D  letters.txt\n')
    expect(existsSync(join(drained, 'letters.txt'))).toBe(false)
  })

  it('keeps the file under --cached', async () => {
    const h = await harness()
    expect(await h.run('rm --cached letters.txt')).toEqual([0, "rm 'letters.txt'\n", ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('D  letters.txt\n?? letters.txt\n')
  })

  it('refuses a directory without -r and removes it with', async () => {
    const h = await harness()
    expect(await h.run('rm docs')).toEqual([
      128,
      '',
      "fatal: not removing 'docs' recursively without -r\n",
    ])
    expect(await h.run('rm -r docs')).toEqual([0, "rm 'docs/readme.md'\n", ''])
    expect(existsSync(join(await h.drain(), 'docs'))).toBe(false)
  })

  it('refuses a local modification and names it', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('rm letters.txt')).toEqual([
      1,
      '',
      'error: the following file has local modifications:\n    letters.txt\n' +
        '(use --cached to keep the file, or -f to force removal)\n',
    ])
  })

  it('groups refusals the way git prints them', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    await write(h, 'numbers.txt', 'edited\n')
    await h.run('add numbers.txt')
    const [code, , err] = await h.run('rm letters.txt numbers.txt')
    expect(code).toBe(1)
    expect(err).toBe(
      'error: the following file has changes staged in the index:\n    numbers.txt\n' +
        '(use --cached to keep the file, or -f to force removal)\n' +
        'error: the following file has local modifications:\n    letters.txt\n' +
        '(use --cached to keep the file, or -f to force removal)\n',
    )
  })

  it('removes over an edit under -f', async () => {
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('rm -f letters.txt')).toEqual([0, "rm 'letters.txt'\n", ''])
  })

  it('refuses an unknown path and a missing pathspec', async () => {
    const h = await harness()
    expect(await h.run('rm nosuch')).toEqual([
      128,
      '',
      "fatal: pathspec 'nosuch' did not match any files\n",
    ])
    expect(await h.run('rm')).toEqual([
      128,
      '',
      'fatal: No pathspec was given. Which files should I remove?\n',
    ])
  })
})

describe('git mv', () => {
  it('renames and stages the rename', async () => {
    const h = await harness()
    expect(await h.run('mv letters.txt moved.txt')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('R  letters.txt -> moved.txt\n')
  })

  it('moves into a directory under the same name', async () => {
    const h = await harness()
    expect(await h.run('mv letters.txt docs')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe(
      'R  letters.txt -> docs/letters.txt\n',
    )
  })

  it('moves a directory with everything under it', async () => {
    const h = await harness()
    await write(h, 'docs/untracked.md', 'u\n')
    expect(await h.run('mv docs notes')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe(
      'R  docs/readme.md -> notes/readme.md\n?? notes/untracked.md\n',
    )
  })

  it('refuses an existing destination unless forced', async () => {
    const h = await harness()
    expect(await h.run('mv letters.txt numbers.txt')).toEqual([
      128,
      '',
      'fatal: destination exists, source=letters.txt, destination=numbers.txt\n',
    ])
    expect(await h.run('mv -f letters.txt numbers.txt')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('D  letters.txt\nM  numbers.txt\n')
  })

  it('words a bad and an untracked source the way git does', async () => {
    const h = await harness()
    expect(await h.run('mv nosuch dest')).toEqual([
      128,
      '',
      'fatal: bad source, source=nosuch, destination=dest\n',
    ])
    await write(h, 'u.txt', 'u\n')
    expect(await h.run('mv u.txt dest')).toEqual([
      128,
      '',
      'fatal: not under version control, source=u.txt, destination=dest\n',
    ])
  })

  it('prints usage for one operand and moves nothing on a dry run', async () => {
    const h = await harness()
    const [code, , err] = await h.run('mv letters.txt')
    expect(code).toBe(129)
    expect(err.startsWith('usage: git mv [-v] [-f] [-n] [-k] <source> <destination>\n')).toBe(true)
    expect(await h.run('mv -n letters.txt moved.txt')).toEqual([
      0,
      "Checking rename of 'letters.txt' to 'moved.txt'\nRenaming letters.txt to moved.txt\n",
      '',
    ])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('')
  })
})

describe('git tag', () => {
  it('creates a lightweight tag the real binary resolves', async () => {
    const h = await harness()
    expect(await h.run('tag v1.0 HEAD~1')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'v1.0'])).toBe('commit\n')
    expect(git(drained, ['rev-parse', 'v1.0'])).toBe(git(drained, ['rev-parse', 'HEAD~1']))
  })

  it('writes an annotated tag git can read back', async () => {
    const h = await harness()
    expect(await h.run("tag -a v1.1 -m 'first release'")).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'v1.1'])).toBe('tag\n')
    expect(git(drained, ['tag', '-n'])).toBe('v1.1            first release\n')
    expect(await h.run('tag -n')).toEqual([0, 'v1.1            first release\n', ''])
  })

  it('stores an empty message as git does', async () => {
    const h = await harness()
    expect(await h.run("tag -a v1.2 -m ''")).toEqual([0, '', ''])
    expect(await h.run('tag -n')).toEqual([0, 'v1.2            \n', ''])
    expect(git(await h.drain(), ['tag', '-n'])).toBe('v1.2            \n')
  })

  it('lists in byte order and filters with -l', async () => {
    const h = await harness()
    for (const name of ['a10', 'a9', 'B']) await h.run(`tag ${name}`)
    expect(await h.run('tag')).toEqual([0, 'B\na10\na9\n', ''])
    expect(await h.run("tag -l 'a*'")).toEqual([0, 'a10\na9\n', ''])
  })

  it('refuses a duplicate, a bad object and a bad name', async () => {
    const h = await harness()
    await h.run('tag v1.0')
    expect(await h.run('tag v1.0')).toEqual([128, '', "fatal: tag 'v1.0' already exists\n"])
    expect(await h.run('tag v2 nosuch')).toEqual([
      128,
      '',
      "fatal: Failed to resolve 'nosuch' as a valid ref.\n",
    ])
    expect(await h.run("tag 'bad name'")).toEqual([
      128,
      '',
      "fatal: 'bad name' is not a valid tag name.\n",
    ])
    expect(await h.run('tag -a v3')).toEqual([
      128,
      '',
      'fatal: no tag message supplied (mirage has no editor to open; pass -m)\n',
    ])
  })

  it('deletes, reporting a miss without stopping', async () => {
    const h = await harness()
    await h.run('tag v1.0')
    const [code, out, err] = await h.run('tag -d nosuch v1.0')
    expect(code).toBe(1)
    expect(out).toBe("Deleted tag 'v1.0' (was 8ef2542)\n")
    expect(err).toBe("error: tag 'nosuch' not found.\n")
    expect(await h.run('tag')).toEqual([0, '', ''])
  })

  it('moves a tag under -f', async () => {
    const h = await harness()
    await h.run('tag v1.0 HEAD~1')
    expect(await h.run('tag -f v1.0')).toEqual([0, "Updated tag 'v1.0' (was 225f39c)\n", ''])
  })
})

describe('a name that escapes the ref tree', () => {
  it('is refused by switch -c, leaving the config alone', async () => {
    const h = await harness()
    const before = await readOptional(h.dispatch, '/repo/.git/config')
    expect(await h.run('switch -c ../../config')).toEqual([
      128,
      '',
      "fatal: '../../config' is not a valid branch name\n" +
        'hint: See `man git check-ref-format`\n' +
        'hint: Disable this message with "git config set advice.refSyntax false"\n',
    ])
    expect(await readOptional(h.dispatch, '/repo/.git/config')).toEqual(before)
  })

  it('is refused by branch, before its start point resolves', async () => {
    const h = await harness()
    const [code, , err] = await h.run('branch ../../config nosuchstart')
    expect(code).toBe(128)
    expect(err.startsWith("fatal: '../../config' is not a valid branch name")).toBe(true)
  })

  it('lets switch name an unresolvable start point first', async () => {
    const h = await harness()
    expect(await h.run('switch -c ../../config nosuchstart')).toEqual([
      128,
      '',
      'fatal: invalid reference: nosuchstart\n',
    ])
  })
})

describe('two mv sources landing on one name', () => {
  async function withTwo(): Promise<Harness> {
    const h = await harness()
    await write(h, 'a/x', 'ax\n')
    await write(h, 'b/x', 'bx\n')
    await write(h, 'dest/keep.txt', 'k\n')
    await h.run('add a b')
    await h.run('commit -m two')
    return h
  }

  it('is refused, and nothing moves', async () => {
    const h = await withTwo()
    expect(await h.run('mv a/x b/x dest')).toEqual([
      128,
      '',
      'fatal: multiple sources for the same target, source=b/x, destination=dest/x\n',
    ])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('?? dest/\n')
  })

  it('is reported by the colliding path when directories carry it', async () => {
    const h = await harness()
    await write(h, 'a/sub/f', '1\n')
    await write(h, 'b/sub/f', '2\n')
    await write(h, 'dest/keep.txt', 'k\n')
    await h.run('add a b')
    await h.run('commit -m dirs')
    const [, , err] = await h.run('mv a/sub b/sub dest')
    expect(err).toBe(
      'fatal: multiple sources for the same target, source=b/sub/f, destination=dest/sub/f\n',
    )
  })

  it('is skipped under -k, moving the first', async () => {
    const h = await withTwo()
    expect(await h.run('mv -k a/x b/x dest')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe(
      'R  a/x -> dest/x\n?? dest/keep.txt\n',
    )
  })
})

describe('git tag creation options', () => {
  it.each(['tag -a', 'tag -m msg', 'tag -f'])('need a name: %s', async (line) => {
    const h = await harness()
    expect(await h.run(line)).toEqual([
      129,
      '',
      'usage: git tag [-a] [-f] [-m <msg>] <tagname> [<commit> | <object>]\n' +
        '   or: git tag -d <tagname>...\n' +
        '   or: git tag [-n[<num>]] -l [<pattern>...]\n',
    ])
  })

  it.each(['tag -l -a v1', 'tag -d -a v1', 'tag -n -f'])(
    'cannot list or delete: %s',
    async (line) => {
      const h = await harness()
      const [code, , err] = await h.run(line)
      expect(code).toBe(129)
      expect(err.startsWith('usage: git tag [-a] [-f] [-m <msg>]')).toBe(true)
    },
  )

  it('leave listing and deleting able to take no name', async () => {
    const h = await harness()
    expect(await h.run('tag')).toEqual([0, '', ''])
    expect(await h.run('tag -d')).toEqual([0, '', ''])
  })
})

describe('a ref that lives only in packed-refs', () => {
  it('is really deleted by tag -d', async () => {
    const h = await harness((repo) => {
      git(repo, ['tag', 'lw'])
      git(repo, ['tag', '-a', 'ann', '-m', 'msg'])
      git(repo, ['pack-refs', '--all'])
      // One loose ref, made after the pack, so `.git/refs` still holds a file:
      // a directory with none is not copied out of the mount, and git reads a
      // tree without `refs/` as not a repository at all.
      git(repo, ['branch', 'keepme'])
    })
    expect(await h.run('tag')).toEqual([0, 'ann\nlw\n', ''])
    expect((await h.run('tag -d lw'))[0]).toBe(0)
    expect((await h.run('tag -d ann'))[0]).toBe(0)
    expect(await h.run('tag')).toEqual([0, '', ''])
    const packed = DEC.decode(
      (await readOptional(h.dispatch, '/repo/.git/packed-refs')) ?? undefined,
    )
    expect(packed).not.toContain('refs/tags/')
    expect(packed).not.toContain('^')
    expect(packed).toContain('refs/heads/main')
    expect(git(await h.drain(), ['tag', '-l'])).toBe('')
  })

  it('is really deleted by branch -D', async () => {
    const h = await harness((repo) => {
      git(repo, ['pack-refs', '--all'])
      git(repo, ['branch', 'keepme'])
    })
    expect((await h.run('branch -D topic'))[0]).toBe(0)
    expect(await h.run('branch')).toEqual([0, '  keepme\n* main\n', ''])
    expect(git(await h.drain(), ['branch', '--list'])).toBe('  keepme\n* main\n')
  })
})

describe('restoring an unmerged path', () => {
  it('clears its conflict stages', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('UU letters.txt\n')
    expect(await h.run('restore --staged letters.txt')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['ls-files', '-u'])).toBe('')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })
})

describe('a path the index left unmerged', () => {
  it('refuses to move as a source of its own', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    expect(await h.run('mv letters.txt moved.txt')).toEqual([
      128,
      '',
      'fatal: conflicted, source=letters.txt, destination=moved.txt\n',
    ])
  })

  it('outranks a destination that already exists', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    const [, , err] = await h.run('mv letters.txt numbers.txt')
    expect(err).toBe('fatal: conflicted, source=letters.txt, destination=numbers.txt\n')
  })

  it('refuses the directory holding it, named by the path itself', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'docs/readme.md')
    })
    expect(await h.run('mv docs notes')).toEqual([
      128,
      '',
      'fatal: conflicted, source=docs/readme.md, destination=notes/readme.md\n',
    ])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('UU docs/readme.md\n')
  })

  it('is skipped under -k', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    expect(await h.run('mv -k letters.txt moved.txt')).toEqual([0, '', ''])
  })
})

describe('a directory holding a symlink', () => {
  it('carries it along when git mv renames the directory', async () => {
    const h = await harness()
    await h.ws.dispatch('symlink', '/repo/docs/link', [], { target: 'readme.md' })
    await h.run('add docs')
    await h.run('commit -m link')
    expect(await h.run('mv docs notes')).toEqual([0, '', ''])
    // The link is namespace state, not a backend entry, so it is read back
    // through the workspace rather than out of the drained copy.
    expect(await h.ws.dispatch('readlink', '/repo/notes/link')).toBe('readme.md')
    expect(await h.run('status --porcelain')).toEqual([
      0,
      'R  docs/link -> notes/link\nR  docs/readme.md -> notes/readme.md\n',
      '',
    ])
    // The index is asserted on the drained copy rather than its status: the
    // drain writes files, so the link lands there as a regular file and the
    // real binary reads the pair as a type change.
    const rows = git(await h.drain(), ['ls-files', '-s'])
    expect(rows).toContain('120000')
    expect(rows).toContain('notes/link')
    expect(rows).not.toContain('docs/link')
  })
})

describe('git switch --detach', () => {
  it('takes HEAD when nothing is named', async () => {
    const h = await harness()
    const [code, , err] = await h.run('switch --detach')
    expect(code).toBe(0)
    expect(err.startsWith('HEAD is now at ')).toBe(true)
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD\n')
    expect(git(drained, ['rev-parse', 'HEAD'])).toBe(git(drained, ['rev-parse', 'main']))
  })

  it('still needs a branch when attaching', async () => {
    const h = await harness()
    const [code, , err] = await h.run('switch')
    expect(code).toBe(128)
    expect(err.startsWith('fatal: ')).toBe(true)
  })
})

describe('a tag target that is not a commit', () => {
  it('points a lightweight tag at a blob', async () => {
    const h = await harness()
    const blob = git(h.repo, ['rev-parse', 'HEAD:letters.txt']).trim()
    expect(await h.run(`tag blobtag ${blob}`)).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'blobtag'])).toBe('blob\n')
    expect(git(drained, ['rev-parse', 'blobtag'])).toBe(`${blob}\n`)
  })

  it('records the type in an annotated tag', async () => {
    const h = await harness()
    const blob = git(h.repo, ['rev-parse', 'HEAD:letters.txt']).trim()
    expect(await h.run(`tag -a annblob -m m ${blob}`)).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'annblob'])).toBe('tag\n')
    expect(git(drained, ['cat-file', '-p', 'annblob']).split('\n')[1]).toBe('type blob')
  })
})

describe('git tag -n0', () => {
  it('prints bare names where -n1 pads them', async () => {
    const h = await harness()
    await h.run("tag -a v1 -m 'the message'")
    expect(await h.run('tag -n0')).toEqual([0, 'v1\n', ''])
    expect(await h.run('tag -n1')).toEqual([0, 'v1              the message\n', ''])
  })
})

describe('git restore --source', () => {
  it('takes a raw tree id', async () => {
    const h = await harness()
    const tree = git(h.repo, ['rev-parse', 'HEAD^{tree}']).trim()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run(`restore --source=${tree} letters.txt`)).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('')
  })

  it('still refuses a source that is no tree at all', async () => {
    const h = await harness()
    const [code, , err] = await h.run('restore --source=nosuch letters.txt')
    expect(code).toBe(128)
    expect(err).toBe('fatal: could not resolve nosuch\n')
  })
})

describe('a name that is a file on one side and a directory on the other', () => {
  it('replaces the file with the directory the source holds', async () => {
    let dir = ''
    const h = await harness((repo) => {
      mkdirSync(join(repo, 'slot'))
      writeFileSync(join(repo, 'slot/child'), 'inner\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'dir'])
      dir = git(repo, ['rev-parse', 'HEAD^{tree}']).trim()
      git(repo, ['rm', '-q', '-r', 'slot'])
      writeFileSync(join(repo, 'slot'), 'flat\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'flat'])
    })
    expect(await h.run(`restore --source=${dir} -SW slot`)).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['ls-files', 'slot'])).toBe('slot/child\n')
    expect(readFileSync(join(drained, 'slot/child'), 'utf8')).toBe('inner\n')
  })

  it('replaces the directory with the file the source holds', async () => {
    let flat = ''
    const h = await harness((repo) => {
      writeFileSync(join(repo, 'slot'), 'flat\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'flat'])
      flat = git(repo, ['rev-parse', 'HEAD^{tree}']).trim()
      git(repo, ['rm', '-q', 'slot'])
      mkdirSync(join(repo, 'slot'))
      writeFileSync(join(repo, 'slot/child'), 'inner\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'dir'])
    })
    expect(await h.run(`restore --source=${flat} -SW slot`)).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['ls-files', 'slot'])).toBe('slot\n')
    expect(readFileSync(join(drained, 'slot'), 'utf8')).toBe('flat\n')
  })
})

describe('an untracked path that collides with the target tree', () => {
  it('refuses a file standing where the target holds a directory', async () => {
    const h = await harness((repo) => {
      git(repo, ['checkout', '-q', '-b', 'other'])
      mkdirSync(join(repo, 'slot'))
      writeFileSync(join(repo, 'slot/file'), 'theirs\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'dir'])
      git(repo, ['checkout', '-q', 'main'])
    })
    await write(h, 'slot', 'mine\n')
    const [code, , err] = await h.run('switch other')
    expect(code).toBe(1)
    expect(err).toBe(
      'error: The following untracked working tree files would be overwritten by ' +
        'checkout:\n\tslot\nPlease move or remove them before you switch branches.\nAborting\n',
    )
  })

  it('refuses a directory standing where the target holds a file', async () => {
    const h = await harness((repo) => {
      git(repo, ['checkout', '-q', '-b', 'other'])
      writeFileSync(join(repo, 'slot'), 'theirs\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-q', '-m', 'file'])
      git(repo, ['checkout', '-q', 'main'])
    })
    await write(h, 'slot/file', 'mine\n')
    const [code, , err] = await h.run('switch other')
    expect(code).toBe(1)
    expect(err).toBe(
      'error: Updating the following directories would lose untracked files in ' +
        'them:\n\tslot\n\nAborting\n',
    )
  })
})

describe('a pathspec that begins with a dash', () => {
  it('moves it when the line escapes it with --', async () => {
    const h = await harness()
    await write(h, '-draft', 'x\n')
    await h.run('add -- -draft')
    expect(await h.run('mv -- -draft kept.txt')).toEqual([0, '', ''])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('A  kept.txt\n')
  })

  it('removes it when the line escapes it with --', async () => {
    const h = await harness()
    await write(h, '-draft', 'x\n')
    await h.run('add -- -draft')
    await h.run('commit -m draft')
    expect(await h.run('rm -- -draft')).toEqual([0, "rm '-draft'\n", ''])
  })

  it('is still an unknown switch unescaped', async () => {
    const h = await harness()
    const [code, , err] = await h.run('rm -draft')
    expect(code).toBe(129)
    expect(err).toBe("error: unknown switch `draft'\n")
  })
})

describe('a rename that would leave a mount behind', () => {
  it('refuses a directory holding one', async () => {
    const h = await harness(undefined, '/repo/docs/inner')
    const [code, , err] = await h.run('mv docs notes')
    expect(code).toBe(128)
    expect(err).toBe("fatal: renaming 'docs' failed: Device or resource busy\n")
    expect(await h.run('status --porcelain')).toEqual([0, '', ''])
  })

  it('refuses the mount root itself', async () => {
    const h = await harness(undefined, '/repo/inner')
    await write(h, 'inner/one.md', 'x\n')
    await h.run('add inner')
    const [code, , err] = await h.run('mv inner elsewhere')
    expect(code).toBe(128)
    expect(err).toBe("fatal: renaming 'inner' failed: Device or resource busy\n")
  })

  it('skips it under -k', async () => {
    const h = await harness(undefined, '/repo/docs/inner')
    expect(await h.run('mv -k docs notes')).toEqual([0, '', ''])
    expect(await h.run('status --porcelain')).toEqual([0, '', ''])
  })

  it('refuses a file moving into another mount', async () => {
    // The source is an ordinary tracked file, so neither "is a mount root"
    // nor "holds one" catches it. The rename op binds to the backend serving
    // the source, so the write would land in the repository's own mount at a
    // path the inner one serves: the file ends up hidden behind that mount
    // while the index names the new path.
    const h = await harness(undefined, '/repo/inner')
    await write(h, 'one.md', 'x\n')
    await h.run('add one.md')
    const [code, , err] = await h.run('mv one.md inner/one.md')
    expect(code).toBe(128)
    expect(err).toBe("fatal: renaming 'one.md' failed: Device or resource busy\n")
  })

  it('refuses a file moving out of a nested mount', async () => {
    const h = await harness(undefined, '/repo/inner')
    await write(h, 'inner/one.md', 'x\n')
    await h.run('add inner/one.md')
    const [code, , err] = await h.run('mv inner/one.md one.md')
    expect(code).toBe(128)
    expect(err).toBe("fatal: renaming 'inner/one.md' failed: Device or resource busy\n")
  })

  it('still moves inside one mount', async () => {
    // The destination check compares the two ends, so an ordinary move that
    // never leaves the repository's own mount is untouched by it.
    const h = await harness(undefined, '/repo/inner')
    await write(h, 'one.md', 'x\n')
    await h.run('add one.md')
    expect(await h.run('mv one.md docs/one.md')).toEqual([0, '', ''])
  })
})

describe('a restore source spelled as a tree expression', () => {
  it('takes a tree peel', async () => {
    // git's own help says --source <tree-ish>, and a peel is the ordinary way
    // to spell one. Probed on git 2.50.1: exit 0.
    const h = await harness()
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('restore --source=HEAD^{tree} letters.txt')).toEqual([0, '', ''])
  })

  it('takes a tag peel', async () => {
    const h = await harness((repo) => {
      git(repo, ['tag', 'v1'])
    })
    await write(h, 'letters.txt', 'edited\n')
    expect(await h.run('restore --source=v1^{tree} letters.txt')).toEqual([0, '', ''])
  })

  it('takes a subtree named at a path', async () => {
    const h = await harness((repo) => {
      mkdirSync(join(repo, 'sub'))
      writeFileSync(join(repo, 'sub', 'letters.txt'), 'nested\n')
      git(repo, ['add', 'sub'])
      git(repo, ['commit', '-m', 'nested'])
    })
    expect(await h.run('restore --source=HEAD:sub letters.txt')).toEqual([0, '', ''])
    expect(DEC.decode((await readOptional(h.dispatch, '/repo/letters.txt')) ?? undefined)).toBe(
      'nested\n',
    )
  })

  it('names the object by its id when it is no tree', async () => {
    // git reports the object it reached, not the spelling: the name resolved
    // fine and what it found was the problem.
    const h = await harness()
    const [code, , err] = await h.run('restore --source=HEAD:letters.txt letters.txt')
    expect(code).toBe(128)
    expect(err).toMatch(/^fatal: unable to read tree \([0-9a-f]{40}\)\n$/)
  })

  it('names the spelling when the peel resolves to nothing', async () => {
    const h = await harness()
    const [code, , err] = await h.run('restore --source=nosuch^{tree} letters.txt')
    expect(code).toBe(128)
    expect(err).toBe('fatal: could not resolve nosuch^{tree}\n')
  })
})

describe('a restore writing a file over an occupied directory', () => {
  it('replaces the directory, untracked child and all', async () => {
    // The source keeps letters.txt as a file, the index keeps
    // letters.txt/child, and an untracked letters.txt/keep holds the
    // directory open. git replaces the whole directory here and exits 0
    // (probed on git 2.50.1); the write would otherwise fail with the index
    // already changed.
    const h = await harness()
    const tree = (await h.run('rev-parse HEAD^{tree}'))[1].trim()
    await h.run('rm --cached letters.txt')
    await h.ws.dispatch('unlink', '/repo/letters.txt')
    await write(h, 'letters.txt/child', 'inner\n')
    await h.run('add letters.txt/child')
    await write(h, 'letters.txt/keep', 'untracked\n')
    expect(await h.run(`restore --source=${tree} -SW letters.txt`)).toEqual([0, '', ''])
    expect(DEC.decode((await readOptional(h.dispatch, '/repo/letters.txt')) ?? undefined)).toBe(
      'alpha\nbeta\ngamma\ndelta\n',
    )
  })
})

describe('a switch while the index is unmerged', () => {
  it('refuses before it moves anything', async () => {
    const h = await harness((repo) => {
      git(repo, ['branch', 'sidebar'])
      conflictIndex(repo, 'letters.txt')
    })
    expect(await h.run('switch sidebar')).toEqual([
      1,
      'letters.txt: needs merge\n',
      'error: you need to resolve your current index first\n',
    ])
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('UU letters.txt\n')
  })

  it('refuses a detach at the commit HEAD already names', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    const [code, out] = await h.run('switch --detach HEAD')
    expect([code, out]).toEqual([1, 'letters.txt: needs merge\n'])
  })

  it('lets a branch created here through, because nothing moves', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    expect(await h.run('switch -c sidebar')).toEqual([
      0,
      '',
      "Switched to a new branch 'sidebar'\n",
    ])
    const drained = await h.drain()
    expect(git(drained, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('sidebar\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('UU letters.txt\n')
  })

  it('refuses the same branch once a start point is named', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    const [code, out] = await h.run('switch -c sidebar HEAD')
    expect([code, out]).toEqual([1, 'letters.txt: needs merge\n'])
  })
})

describe('a name that swaps between file and directory across branches', () => {
  it('switches from the file to the directory', async () => {
    const h = await harness((repo) => {
      // Both trees are built with the real binary, because a swap this
      // shape is exactly what the verbs under test used to get wrong.
      writeFileSync(join(repo, 'slot'), 'flat\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-m', 'flat'])
      git(repo, ['checkout', '-q', '-b', 'other'])
      git(repo, ['rm', '-q', 'slot'])
      mkdirSync(join(repo, 'slot'))
      writeFileSync(join(repo, 'slot', 'child'), 'deep\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-m', 'deep'])
      git(repo, ['checkout', '-q', 'main'])
    })
    expect(await h.run('switch other')).toEqual([0, '', "Switched to branch 'other'\n"])
    const drained = await h.drain()
    expect(readFileSync(join(drained, 'slot', 'child'), 'utf8')).toBe('deep\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })

  it('switches from the directory back to the file', async () => {
    const h = await harness((repo) => {
      mkdirSync(join(repo, 'slot'))
      writeFileSync(join(repo, 'slot', 'child'), 'deep\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-m', 'deep'])
      git(repo, ['checkout', '-q', '-b', 'other'])
      git(repo, ['rm', '-q', 'slot/child'])
      writeFileSync(join(repo, 'slot'), 'flat\n')
      git(repo, ['add', 'slot'])
      git(repo, ['commit', '-m', 'flat'])
      git(repo, ['checkout', '-q', 'main'])
    })
    expect(await h.run('switch other')).toEqual([0, '', "Switched to branch 'other'\n"])
    const drained = await h.drain()
    expect(readFileSync(join(drained, 'slot'), 'utf8')).toBe('flat\n')
    expect(git(drained, ['status', '--porcelain'])).toBe('')
  })
})

describe('a restore naming an unmerged path', () => {
  it('refuses when the source holds nothing to put back', async () => {
    const h = await harness((repo) => {
      // Added on this side only, so HEAD holds nothing to restore from
      // and the index holds no stage 0 either.
      writeFileSync(join(repo, 'fresh.txt'), 'mine\n')
      git(repo, ['add', 'fresh.txt'])
      conflictIndex(repo, 'fresh.txt', [2, 3])
    })
    expect(await h.run('restore --staged fresh.txt')).toEqual([
      1,
      '',
      "error: path 'fresh.txt' is unmerged\n",
    ])
    expect(git(await h.drain(), ['ls-files', '-u'])).not.toBe('')
  })

  it('refuses a working-tree restore, whose source is the index', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
    })
    expect(await h.run('restore letters.txt')).toEqual([
      1,
      '',
      "error: path 'letters.txt' is unmerged\n",
    ])
  })

  it('names every one it cannot restore', async () => {
    const h = await harness((repo) => {
      conflictIndex(repo, 'letters.txt')
      conflictIndex(repo, 'numbers.txt')
    })
    const [code, , err] = await h.run('restore letters.txt numbers.txt')
    expect([code, err]).toEqual([
      1,
      "error: path 'letters.txt' is unmerged\nerror: path 'numbers.txt' is unmerged\n",
    ])
  })
})

describe('a tag target spelled as an object expression', () => {
  it('takes a tree', async () => {
    const h = await harness()
    expect(await h.run('tag treetag HEAD^{tree}')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'treetag']).trim()).toBe('tree')
    expect(git(drained, ['rev-parse', 'treetag'])).toBe(git(drained, ['rev-parse', 'HEAD^{tree}']))
  })

  it('takes a blob at a path', async () => {
    const h = await harness()
    expect(await h.run('tag blobtag HEAD:letters.txt')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'blobtag']).trim()).toBe('blob')
    expect(git(drained, ['rev-parse', 'blobtag'])).toBe(
      git(drained, ['rev-parse', 'HEAD:letters.txt']),
    )
  })

  it('records the type on an annotated tag', async () => {
    const h = await harness()
    expect((await h.run('tag -a -m msg noted HEAD:letters.txt'))[0]).toBe(0)
    expect(git(await h.drain(), ['cat-file', '-p', 'noted'])).toContain('type blob')
  })

  it('refuses one that resolves to nothing', async () => {
    const h = await harness()
    expect(await h.run('tag missed HEAD:nosuch')).toEqual([
      128,
      '',
      "fatal: Failed to resolve 'HEAD:nosuch' as a valid ref.\n",
    ])
  })
})

/**
 * What `.git/HEAD` holds, read back through the mount.
 *
 * A repository with no commits cannot be drained and handed to the real binary:
 * `git init` leaves `objects` and `refs` empty, the drain copies files rather
 * than directories, and git reads the result as no repository at all. So the
 * unborn cases assert against the mount, which is where the state they are
 * about lives.
 */
async function headOf(h: Harness): Promise<string> {
  const raw = await readOptional(h.dispatch, '/repo/.git/HEAD')
  return raw === null ? '' : DEC.decode(raw).trim()
}

/**
 * Replace a built fixture with a repository that has no commits.
 *
 * Used as a `prepare` callback: the builder's whole job is to produce
 * history, so an unborn HEAD is reached by discarding what it made rather
 * than by keeping a second builder in step with the first.
 */
function unborn(repo: string): void {
  for (const name of readdirSync(repo)) rmSync(join(repo, name), { recursive: true, force: true })
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' })
}

describe('git switch on an unborn HEAD', () => {
  it('creates the branch with no start point', async () => {
    const h = await harness(unborn)
    expect(await h.run('switch -c topic')).toEqual([0, '', "Switched to a new branch 'topic'\n"])
    expect(await headOf(h)).toBe('ref: refs/heads/topic')
    // No ref and no reflog: a branch with no commit is a name and nothing
    // else, which is why git can make one here at all.
    expect(await readOptional(h.dispatch, '/repo/.git/refs/heads/topic')).toBe(null)
    expect(await readOptional(h.dispatch, '/repo/.git/logs/HEAD')).toBe(null)
  })

  it('refuses a start point', async () => {
    const h = await harness(unborn)
    expect(await h.run('switch -c topic main')).toEqual([
      128,
      '',
      'fatal: invalid reference: main\n',
    ])
    expect(await headOf(h)).toBe('ref: refs/heads/main')
  })

  it('refuses an invalid branch name', async () => {
    const h = await harness(unborn)
    const [code, , err] = await h.run('switch -c ../../evil')
    expect(code).toBe(128)
    expect(err.startsWith("fatal: '../../evil' is not a valid branch name\n")).toBe(true)
    expect(await headOf(h)).toBe('ref: refs/heads/main')
  })
})

describe('staged work carried across a switch', () => {
  it('keeps a staged addition staged', async () => {
    const h = await harness()
    expect((await h.run('branch other'))[0]).toBe(0)
    await h.ws.execute('echo new > /repo/added.txt')
    expect((await h.run('add added.txt'))[0]).toBe(0)
    expect(await h.run('switch other')).toEqual([
      0,
      'A\tadded.txt\n',
      "Switched to branch 'other'\n",
    ])
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('A  added.txt\n')
  })

  it('keeps a staged deletion staged', async () => {
    const h = await harness()
    expect((await h.run('branch other'))[0]).toBe(0)
    expect((await h.run('rm --cached letters.txt'))[0]).toBe(0)
    expect(await h.run('switch other')).toEqual([
      0,
      'D\tletters.txt\n',
      "Switched to branch 'other'\n",
    ])
    // The file itself stays where it is, now untracked: git carries the
    // staged deletion rather than writing the branch's copy back over it.
    expect(git(await h.drain(), ['status', '--porcelain'])).toBe('D  letters.txt\n?? letters.txt\n')
  })

  it('letters a carried worktree edit by where it stands', async () => {
    const h = await harness()
    expect((await h.run('branch other'))[0]).toBe(0)
    await h.ws.execute('echo edited > /repo/letters.txt')
    expect(await h.run('switch other')).toEqual([
      0,
      'M\tletters.txt\n',
      "Switched to branch 'other'\n",
    ])
  })
})

describe('git restore before the first commit', () => {
  it('refuses to restore the index', async () => {
    const h = await harness(unborn)
    await h.ws.execute('echo hi > /repo/f.txt')
    expect((await h.run('add f.txt'))[0]).toBe(0)
    expect(await h.run('restore --staged f.txt')).toEqual([
      128,
      '',
      'fatal: could not resolve HEAD\n',
    ])
    // The refusal comes before the index is touched: reading the unborn
    // HEAD as an empty tree unstaged the path and said nothing.
    expect(await h.run('status --short')).toEqual([0, 'A  f.txt\n', ''])
  })

  it('refuses both targets together the same way', async () => {
    const h = await harness(unborn)
    await h.ws.execute('echo hi > /repo/f.txt')
    expect((await h.run('add f.txt'))[0]).toBe(0)
    expect(await h.run('restore -SW f.txt')).toEqual([128, '', 'fatal: could not resolve HEAD\n'])
  })

  it('still restores the working tree from the index', async () => {
    const h = await harness(unborn)
    await h.ws.execute('echo hi > /repo/f.txt')
    expect((await h.run('add f.txt'))[0]).toBe(0)
    await h.ws.execute('echo edited > /repo/f.txt')
    expect(await h.run('restore f.txt')).toEqual([0, '', ''])
    expect(DEC.decode((await h.ws.execute('cat /repo/f.txt')).stdout)).toBe('hi\n')
  })
})

describe('a peel naming the tag type', () => {
  it('stops at the tag object itself', async () => {
    const h = await harness()
    expect((await h.run('tag -a v1 -m annotated'))[0]).toBe(0)
    expect(await h.run('tag nested v1^{tag}')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'nested']).trim()).toBe('tag')
    expect(git(drained, ['rev-parse', 'nested'])).toBe(git(drained, ['rev-parse', 'v1']))
  })

  it('still unwraps the tag for a bare peel', async () => {
    const h = await harness()
    expect((await h.run('tag -a v1 -m annotated'))[0]).toBe(0)
    expect((await h.run('tag inner v1^{}'))[0]).toBe(0)
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-t', 'inner']).trim()).toBe('commit')
  })

  it('refuses a lightweight tag, which has no tag object to stop at', async () => {
    const h = await harness()
    expect((await h.run('tag light'))[0]).toBe(0)
    expect((await h.run('tag nested light^{tag}'))[0]).toBe(128)
  })
})

describe('git rm over a directory', () => {
  it('refuses the path and leaves the index as it stood', async () => {
    const h = await harness()
    await h.ws.execute('rm /repo/numbers.txt && mkdir /repo/numbers.txt')
    await write(h, 'numbers.txt/keep', 'k\n')
    const [code, out, err] = await h.run('rm numbers.txt')
    expect(code).toBe(128)
    expect(err).toBe("fatal: git rm: 'numbers.txt': Is a directory\n")
    // git prints the line for every selected path before it deletes
    // anything, so it is printed whether the line goes through or not.
    expect(out).toBe("rm 'numbers.txt'\n")
    // The index is written last, so the entry is still staged.
    expect(git(await h.drain(), ['ls-files', 'numbers.txt'])).toBe('numbers.txt\n')
  })

  it('tolerates the refusal once a deletion has been made', async () => {
    const h = await harness()
    await h.ws.execute('rm /repo/numbers.txt && mkdir /repo/numbers.txt')
    await write(h, 'numbers.txt/keep', 'k\n')
    // letters.txt sorts first and goes, so numbers.txt's failure is
    // swallowed and the whole line succeeds with both entries unstaged.
    const [code, out, err] = await h.run('rm -f letters.txt numbers.txt')
    expect([code, err]).toEqual([0, ''])
    expect(out).toBe("rm 'letters.txt'\nrm 'numbers.txt'\n")
    const drained = await h.drain()
    expect(git(drained, ['ls-files', 'letters.txt', 'numbers.txt'])).toBe('')
  })

  it('stands when nothing has gone yet', async () => {
    const h = await harness()
    await h.ws.execute('rm /repo/letters.txt && mkdir /repo/letters.txt')
    const [code, , err] = await h.run('rm -f letters.txt numbers.txt')
    expect(code).toBe(128)
    expect(err).toBe("fatal: git rm: 'letters.txt': Is a directory\n")
    // numbers.txt is never reached, in the working tree or the index.
    expect(await readOptional(h.dispatch, '/repo/numbers.txt')).not.toBeNull()
  })

  it('unstages a directory under --cached without touching it', async () => {
    const h = await harness()
    await h.ws.execute('rm /repo/numbers.txt && mkdir /repo/numbers.txt')
    await write(h, 'numbers.txt/keep', 'k\n')
    expect(await h.run('rm --cached numbers.txt')).toEqual([0, "rm 'numbers.txt'\n", ''])
    expect(await readOptional(h.dispatch, '/repo/numbers.txt/keep')).not.toBeNull()
  })

  it('removes a tracked link to a directory as the link it is', async () => {
    const h = await harness()
    await h.ws.execute('ln -s docs /repo/slot')
    expect((await h.run('add -A'))[0]).toBe(0)
    expect((await h.run('commit -m linked'))[0]).toBe(0)
    expect(await h.run('rm slot')).toEqual([0, "rm 'slot'\n", ''])
    // The link went; the directory it pointed at stayed.
    expect(await readOptional(h.dispatch, '/repo/docs/readme.md')).not.toBeNull()
  })
})

describe('restore across a symlink ancestor', () => {
  it('replaces a link standing where a directory belongs', async () => {
    const h = await harness()
    await h.ws.execute('mkdir /repo/elsewhere')
    await write(h, 'elsewhere/readme.md', 'old\n')
    await h.ws.execute('rm -r /repo/docs && ln -s elsewhere /repo/docs')
    expect(await h.run('restore docs/readme.md')).toEqual([0, '', ''])
    // Writing through the link would have landed the content in
    // elsewhere/readme.md, a file no branch named, and left the link.
    const restored = await readOptional(h.dispatch, '/repo/docs/readme.md')
    expect(restored === null ? '' : DEC.decode(restored)).toBe('notes\n')
    const other = await readOptional(h.dispatch, '/repo/elsewhere/readme.md')
    expect(other === null ? '' : DEC.decode(other)).toBe('old\n')
    // A link is namespace state, so whether it is gone is a question
    // for the namespace rather than for the drained copy.
    expect((await h.ws.execute('readlink /repo/docs')).exitCode).not.toBe(0)
  })

  it('attempts no removal through one', async () => {
    const h = await harness()
    await h.ws.execute('mkdir /repo/elsewhere')
    await write(h, 'elsewhere/readme.md', 'old\n')
    await h.ws.execute('rm -r /repo/docs && ln -s elsewhere /repo/docs')
    // HEAD~2 predates the entry, so restoring from it removes the path;
    // the unlink would resolve past the link and delete a file inside
    // whatever it points at. git checks the leading path and removes
    // nothing, link and target both left as they stand.
    expect(await h.run('restore --source=HEAD~2 docs/readme.md')).toEqual([0, '', ''])
    const other = await readOptional(h.dispatch, '/repo/elsewhere/readme.md')
    expect(other === null ? '' : DEC.decode(other)).toBe('old\n')
    const told = await h.ws.execute('readlink /repo/docs')
    expect([told.exitCode, DEC.decode(told.stdout)]).toEqual([0, 'elsewhere\n'])
  })
})

describe('a tag named by a bare id', () => {
  it('is the tag object, not the commit behind it', async () => {
    const h = await harness()
    expect((await h.run('tag -a v1 -m annotated'))[0]).toBe(0)
    const held = git(await h.drain(), ['rev-parse', 'v1']).trim()
    expect((await h.run(`tag -a nested -m x ${held}`))[0]).toBe(0)
    const drained = await h.drain()
    // git reads a bare id as that exact object, so the new tag points
    // at the tag rather than at the commit behind it.
    expect(git(drained, ['cat-file', '-p', 'nested']).split('\n')[1]).toBe('type tag')
    expect(git(drained, ['fsck'])).toBe('')
  })

  it('still names a source tree for restore', async () => {
    const h = await harness()
    expect((await h.run('tag -a v1 -m annotated'))[0]).toBe(0)
    const held = git(await h.drain(), ['rev-parse', 'v1']).trim()
    await write(h, 'letters.txt', 'edited\n')
    // The id names the tag object itself, which is no tree-ish; a
    // source unwraps it, so this reads what `--source=v1` reads.
    expect(await h.run(`restore --source=${held} letters.txt`)).toEqual([0, '', ''])
    const back = await readOptional(h.dispatch, '/repo/letters.txt')
    expect(back === null ? '' : DEC.decode(back)).toBe('alpha\nbeta\ngamma\ndelta\n')
  })
})

describe('a lightweight tag as an annotated tag target', () => {
  it('keeps the blob type it points at', async () => {
    const h = await harness()
    expect((await h.run('tag blobtag HEAD:letters.txt'))[0]).toBe(0)
    expect(await h.run('tag -a release -m x blobtag')).toEqual([0, '', ''])
    const drained = await h.drain()
    // `type commit` beside a blob id is a tag object git show and git
    // fsck both reject.
    expect(git(drained, ['cat-file', '-p', 'release']).split('\n')[1]).toBe('type blob')
    expect(git(drained, ['fsck'])).toBe('')
    expect(git(drained, ['show', 'release'])).toContain('alpha')
  })

  it('keeps the tree type it points at', async () => {
    const h = await harness()
    expect((await h.run('tag treetag HEAD^{tree}'))[0]).toBe(0)
    expect(await h.run('tag -a treerel -m x treetag')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-p', 'treerel']).split('\n')[1]).toBe('type tree')
    expect(git(drained, ['fsck'])).toBe('')
  })

  it('still records a commit for a lightweight tag on one', async () => {
    const h = await harness()
    expect((await h.run('tag light'))[0]).toBe(0)
    expect(await h.run('tag -a fromlight -m x light')).toEqual([0, '', ''])
    const drained = await h.drain()
    expect(git(drained, ['cat-file', '-p', 'fromlight']).split('\n')[1]).toBe('type commit')
  })
})
