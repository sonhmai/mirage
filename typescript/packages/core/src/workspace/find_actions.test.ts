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

import { describe, expect, it } from 'vitest'
import { OpsRegistry } from '../ops/registry.ts'
import { RAMResource } from '../resource/ram/ram.ts'
import { MountMode } from '../types.ts'
import { getTestParser } from './fixtures/workspace_fixture.ts'
import { Workspace } from './workspace/workspace.ts'

async function singleMountWs(): Promise<Workspace> {
  const parser = await getTestParser()
  const ops = new OpsRegistry()
  const root = new RAMResource()
  ops.registerResource(root)
  return new Workspace({ '/': root }, { mode: MountMode.WRITE, ops, shellParser: parser })
}

async function twoMountWs(): Promise<Workspace> {
  const parser = await getTestParser()
  const ops = new OpsRegistry()
  const root = new RAMResource()
  const a = new RAMResource()
  const b = new RAMResource()
  ops.registerResource(root)
  ops.registerResource(a)
  ops.registerResource(b)
  return new Workspace(
    { '/': root, '/a': a, '/b': b },
    { mode: MountMode.WRITE, ops, shellParser: parser },
  )
}

async function setupHtmlFiles(ws: Workspace): Promise<void> {
  ws.createSession('s')
  await ws.execute('mkdir -p /a/b', { sessionId: 's' })
  await ws.execute('touch /foo.html /bar.htm /a/b/baz.html', { sessionId: 's' })
}

describe('find action layer', () => {
  describe('-delete', () => {
    it('removes matched files', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html' -delete", { sessionId: 's' })
      expect(r.exitCode).toBe(0)
      expect(r.stdoutText).toBe('')
      const after = await ws.execute("find / -name '*.html'", { sessionId: 's' })
      expect(after.stdoutText).toBe('')
      const htm = await ws.execute("find / -name '*.htm'", { sessionId: 's' })
      expect(htm.stdoutText).toContain('/bar.htm')
    })

    it('is silent unless -print is also given', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html' -delete", { sessionId: 's' })
      expect(r.stdoutText).toBe('')
    })

    it('emits matches when -print -delete is combined', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html' -print -delete", {
        sessionId: 's',
      })
      const out = r.stdoutText
      expect(out).toContain('/foo.html')
      expect(out).toContain('/a/b/baz.html')
    })

    it('skips mount roots', async () => {
      const ws = await twoMountWs()
      ws.createSession('s')
      await ws.execute('touch /a/x.html /b/y.html', { sessionId: 's' })
      // Without -name, /a and /b appear as synthetic dir entries.
      // -delete must skip them.
      await ws.execute('find / -type d -delete', { sessionId: 's' })
      const ls = await ws.execute('ls /', { sessionId: 's' })
      const out = ls.stdoutText
      expect(out).toContain('a')
      expect(out).toContain('b')
    })

    it('orders deepest-first so children clear before parents', async () => {
      const ws = await singleMountWs()
      ws.createSession('s')
      await ws.execute('mkdir -p /tmp/a/b', { sessionId: 's' })
      await ws.execute('touch /tmp/a/b/file.txt', { sessionId: 's' })
      const r = await ws.execute("find /tmp -name '*.txt' -delete", {
        sessionId: 's',
      })
      expect(r.exitCode).toBe(0)
    })

    it('removes directories emptied by the deepest-first pass', async () => {
      const ws = await singleMountWs()
      ws.createSession('s')
      await ws.execute('mkdir -p /tree/deep', { sessionId: 's' })
      await ws.execute('touch /tree/deep/f.txt', { sessionId: 's' })
      const r = await ws.execute('find /tree -delete', { sessionId: 's' })
      expect(r.exitCode).toBe(0)
      expect(r.stderrText).toBe('')
      const after = await ws.execute('find / -name tree', { sessionId: 's' })
      expect(after.stdoutText).toBe('')
    })
  })

  describe('-print0', () => {
    it('separates matches with NUL bytes', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html' -print0", { sessionId: 's' })
      const out = r.stdoutText
      expect(out).toContain('\x00')
      // No newlines outside the NUL separators.
      expect(out.split('\x00').join('')).not.toContain('\n')
      expect(out.endsWith('\x00')).toBe(true)
    })
  })

  describe('-ls', () => {
    it('emits long-format listing per match', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html' -ls", { sessionId: 's' })
      const lines = r.stdoutText.split('\n').filter((l) => l !== '')
      expect(lines.length).toBeGreaterThanOrEqual(2)
      for (const line of lines) {
        expect(line[0]).toMatch(/[-dl]/)
      }
    })
  })

  describe('default behavior', () => {
    it('find without action flags is unchanged', async () => {
      const ws = await singleMountWs()
      await setupHtmlFiles(ws)
      const r = await ws.execute("find / -name '*.html'", { sessionId: 's' })
      const out = r.stdoutText
      expect(out).toContain('/foo.html')
      expect(out).toContain('/a/b/baz.html')
      expect(out).not.toContain('\x00')
    })
  })

  describe('synthetic mount entries', () => {
    it('honors -name on mount roots', async () => {
      const ws = await twoMountWs()
      ws.createSession('s')
      const r = await ws.execute("find / -name 'a' -type d", { sessionId: 's' })
      const lines = r.stdoutText
        .trim()
        .split('\n')
        .filter((l) => l !== '')
      expect(lines).toContain('/a')
      expect(lines).not.toContain('/b')
    })
  })
})

describe('find -exec isolation', () => {
  for (const terminator of ['\\;', '{} +']) {
    const actions =
      terminator === '{} +'
        ? ['batch', 'mutate', 'mutate_exit']
        : [
            'cd /',
            'unset KEEP',
            'export KEEP=child',
            'set -- child',
            'set -u',
            'mutate',
            'mutate_exit',
          ]
    it.each(actions)(`isolates %s ${terminator}`, async (action) => {
      const ws = await singleMountWs()
      try {
        await ws.execute(
          'batch() { KEEP=child; cd /; set -- child; set -u; }; mkdir -p /w/d; touch /w/d/a.txt /w/d/b.txt; cd /w; KEEP=parent; set -- original; ' +
            'mutate() { echo "$KEEP:$PWD"; KEEP=child; cd /; }; ' +
            'mutate_exit() { KEEP=child; cd /; exit 7; }',
        )
        const io = await ws.execute(
          `find d -name '*.txt' -exec ${action} ${terminator}; ` +
            'echo "$KEEP:$PWD:$1"; echo "${UNSET_FOR_TEST}"',
        )
        expect(io.stdoutText.endsWith('parent:/w:original\n\n')).toBe(true)
        if (action === 'mutate' && terminator === '\\;') {
          expect(io.stdoutText).toBe('parent:/w\n'.repeat(2) + 'parent:/w:original\n\n')
        }
        expect(io.stderrText).toBe('')
        expect(io.exitCode).toBe(0)
      } finally {
        await ws.close()
      }
    })
  }

  it('keeps the stderr of a program that exits 127, and names only a missing one', async () => {
    const ws = await singleMountWs()
    try {
      await ws.execute('mkdir -p /w/d; cd /w')
      const own = await ws.execute(
        "find d -maxdepth 0 -exec sh -c 'echo ownerr >&2; exit 127' \\; ; echo rc=$?",
      )
      expect([own.stdoutText, own.stderrText, own.exitCode]).toEqual(['rc=0\n', 'ownerr\n', 0])
      const missing = await ws.execute('find d -maxdepth 0 -exec nosuchcmd {} \\; ; echo rc=$?')
      expect([missing.stdoutText, missing.stderrText, missing.exitCode]).toEqual([
        'rc=0\n',
        "find: 'nosuchcmd': No such file or directory\n",
        0,
      ])
    } finally {
      await ws.close()
    }
  })

  it('runs -delete at its position, in -depth order, and ends the chain on a failure', async () => {
    const ws = await singleMountWs()
    const seed =
      "mkdir -p /w/d/sub; printf 'a\\n' > /w/d/a.txt; printf 'bb\\n' > /w/d/b.txt; " +
      'printf x > /w/d/sub/c.txt; cd /w'
    const out = async (line: string): Promise<[string, string, number]> => {
      const r = await ws.execute(line)
      return [r.stdoutText, r.stderrText, r.exitCode]
    }
    try {
      // GNU: the row is gone before the next action sees it, so cat
      // fails, its failure ends the chain, and -print never fires.
      await ws.execute(seed)
      expect(await out('find d -type f -delete -exec cat {} \\; -print')).toEqual([
        '',
        'cat: d/a.txt: No such file or directory\n' +
          'cat: d/b.txt: No such file or directory\n' +
          'cat: d/sub/c.txt: No such file or directory\n',
        0,
      ])
      expect(await out('find d -type f')).toEqual(['', '', 0])
      // -delete implies -depth, so every action runs in that order.
      await ws.execute(seed)
      expect(await out('find d -exec echo saw {} \\; -delete -print')).toEqual([
        'saw d/a.txt\nd/a.txt\nsaw d/b.txt\nd/b.txt\nsaw d/sub/c.txt\nd/sub/c.txt\n' +
          'saw d/sub\nd/sub\nsaw d\nd\n',
        '',
        0,
      ])
      expect(await out('test -e d')).toEqual(['', '', 1])
      await ws.execute(seed)
      const post = 'd/a.txt\nd/b.txt\nd/sub/c.txt\nd/sub\nd\n'
      expect(await out('find d -depth')).toEqual([post, '', 0])
      expect(await out('find d -depth -print')).toEqual([post, '', 0])
      expect(await out('find d')).toEqual(['d\nd/a.txt\nd/b.txt\nd/sub\nd/sub/c.txt\n', '', 0])
      expect(await out('find d ! -name c.txt -delete -print')).toEqual([
        'd/a.txt\nd/b.txt\n',
        "find: cannot delete 'd/sub': Directory not empty\n" +
          "find: cannot delete 'd': Directory not empty\n",
        1,
      ])
      expect(await out('find d -name c.txt -delete -delete -print')).toEqual([
        '',
        "find: cannot delete 'd/sub/c.txt': No such file or directory\n",
        1,
      ])
    } finally {
      await ws.close()
    }
  })

  it.each(['-exec touch marker \\;', '-print', '-delete'])(
    'refuses a later test before %s has side effects',
    async (action) => {
      const ws = await singleMountWs()
      try {
        await ws.execute('mkdir -p /w/d; touch /w/d/a.txt; cd /w')
        const io = await ws.execute(`find d ${action} -name '*.txt' -print`)
        expect([io.stdoutText, io.stderrText, io.exitCode]).toEqual([
          '',
          'find: -name: tests after actions are not supported\n',
          1,
        ])
        expect((await ws.execute('test ! -e marker && test -e d/a.txt')).exitCode).toBe(0)
      } finally {
        await ws.close()
      }
    },
  )
})

for (const nested of [false, true]) {
  it.each(['-exec rm {} \\;', '-exec rm {} +', '-delete'])(
    `preserves newline paths (nested: ${String(nested)}) with %s`,
    async (action) => {
      const ws = nested ? await twoMountWs() : await singleMountWs()
      try {
        const root = nested ? '/a/d' : '/d'
        await ws.execute(`mkdir -p ${root}; touch "${root}/a\nb" /bystander`)
        const io = await ws.execute(`find ${nested ? '/' : '/d'} -name 'a*' -type f ${action}`)
        expect(io.exitCode).toBe(0)
        expect(io.stderrText).toBe('')
        const check = await ws.execute(`test -f /bystander && test ! -e "${root}/a\nb"`)
        expect(check.exitCode).toBe(0)
      } finally {
        await ws.close()
      }
    },
  )
}

it('refuses deletion under OR before removing any file', async () => {
  const ws = await singleMountWs()
  try {
    await ws.execute('mkdir d; touch d/keep d/remove')
    const io = await ws.execute('find d -name keep -o -delete')
    expect(io.exitCode).toBe(1)
    expect(io.stderrText).toContain('supported only in a top-level')
    expect((await ws.execute('test -f d/keep && test -f d/remove')).exitCode).toBe(0)
  } finally {
    await ws.close()
  }
})

it('preserves newline mount names and filenames through print0 and ls', async () => {
  const parser = await getTestParser()
  const ops = new OpsRegistry()
  const root = new RAMResource()
  const nested = new RAMResource()
  ops.registerResource(root)
  ops.registerResource(nested)
  const ws = new Workspace(
    { '/': root, '/d/nested\nmount': nested },
    {
      mode: MountMode.WRITE,
      ops,
      shellParser: parser,
    },
  )
  try {
    await ws.execute('touch "/d/nested\nmount/a\nb"')
    const printed = await ws.execute('find /d -print0')
    expect(printed.stdoutText).toBe('/d\0/d/nested\nmount\0/d/nested\nmount/a\nb\0')
    expect(printed.stderrText).toBe('')
    const listed = await ws.execute('find /d -type f -ls')
    expect(listed.exitCode).toBe(0)
    expect(listed.stderrText).toBe('')
    expect(listed.stdoutText).toContain('a\nb')
  } finally {
    await ws.close()
  }
})
