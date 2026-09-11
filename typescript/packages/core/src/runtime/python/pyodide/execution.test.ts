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

import { WorkspaceBinding } from '../../binding.ts'
import { describe, expect, it } from 'vitest'
import { PathSpec } from '../../../types.ts'
import { PyodideRuntime } from './runtime.ts'
import { PrefixResolver } from '../../resolver.ts'
import { loadPyodideRuntime } from './loader.ts'
import { PyodideExecution } from './execution.ts'
describe('Python guest module', { timeout: 120_000 }, () => {
  it('releases converted arguments and keeps helper globals outside guest programs', async () => {
    const pyodide = await loadPyodideRuntime()
    const toPy = pyodide.toPy
    const converted: { toJs: () => unknown }[] = []
    pyodide.toPy = (value) => {
      const proxy = toPy(value)
      if (proxy !== null && typeof proxy === 'object' && 'toJs' in proxy)
        converted.push(proxy as { toJs: () => unknown })
      return proxy
    }
    const guest = new PyodideExecution(pyodide)
    try {
      expect(guest.evaluate("'run' in globals() or '_saved_env' in globals()", {})[0]).toBe('false')
      // The first proxy owns the module; each later proxy is a call argument.
      for (const proxy of converted.slice(1)) expect(() => proxy.toJs()).toThrow(/destroyed/i)
      expect(pyodide.runPython("'_saved_env' in globals() or '_eval_result' in globals()")).toBe(
        false,
      )
      expect(guest.repl('answer = 42', 'one', {})[2]).toBe(0)
      expect(new TextDecoder().decode(guest.repl('answer', 'one', {})[0])).toBe('42\n')
      expect(guest.repl('answer', 'two', {})[2]).toBe(1)
    } finally {
      guest.close()
    }
    for (const proxy of converted) expect(() => proxy.toJs()).toThrow(/destroyed/i)
  })

  it('distinguishes absent and empty stdin for script CLIs without changing ordinary globals', async () => {
    const rt = new PyodideRuntime()
    try {
      for (const [stdin, expected] of [
        [null, 'None'],
        [new Uint8Array(), "b''"],
      ] as const) {
        const result = await rt.run({
          code: 'print(argv); print(stdin)',
          prog: 'pager',
          args: ['one'],
          scriptCli: true,
          env: {},
          stdin,
        })
        expect(result.exitCode).toBe(0)
        expect(new TextDecoder().decode(result.stdout)).toBe(`['pager', 'one']\n${expected}\n`)
      }
      const ordinary = await rt.run({
        code: "print('argv' in globals(), 'stdin' in globals())",
        prog: '/work/script.py',
        args: [],
        env: {},
        stdin: null,
      })
      expect(new TextDecoder().decode(ordinary.stdout)).toBe('False False\n')
    } finally {
      await rt.close()
    }
  })
})

describe('Pyodide command cwd', { timeout: 120_000 }, () => {
  it.each([false, true])(
    'keeps executing with a cwd on an unsupported root mount (eager: %s)',
    async (eager) => {
      const rt = new PyodideRuntime()
      try {
        if (eager) await rt.eval('pass')
        rt.bind(
          new WorkspaceBinding(
            () => Promise.reject(new Error('root mount must not be read')),
            new PrefixResolver(() => ['/']),
          ),
        )
        const before = await rt.eval('import os; os.getcwd()')
        if (typeof before.value !== 'string') throw new Error('cwd must be a string')
        const result = await rt.run({
          code: 'import os; print(1); print(os.getcwd())',
          args: [],
          env: {},
          stdin: null,
          cwd: PathSpec.fromStrPath('/unservable/nested'),
        })
        expect(result.exitCode).toBe(0)
        expect(new TextDecoder().decode(result.stdout)).toBe(`1\n${before.value}\n`)
        const root = await rt.run({
          code: 'import os; print(os.getcwd())',
          args: [],
          env: {},
          stdin: null,
          cwd: PathSpec.fromStrPath('/'),
        })
        expect(root.exitCode).toBe(0)
        expect(new TextDecoder().decode(root.stdout)).toBe('/\n')
      } finally {
        await rt.close()
      }
    },
  )

  it('still rejects a missing cwd on a supported child of a root mount', async () => {
    const rt = new PyodideRuntime()
    rt.bind(
      new WorkspaceBinding(
        () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        new PrefixResolver(() => ['/', '/data/']),
      ),
    )
    try {
      const result = await rt.run({
        code: "print('must not run')",
        args: [],
        env: {},
        stdin: null,
        cwd: PathSpec.fromStrPath('/data/missing'),
      })
      expect(result.exitCode).toBe(1)
      expect(new TextDecoder().decode(result.stdout)).toBe('')
    } finally {
      await rt.close()
    }
  })

  it('restores trusted cwd functions when user code replaces or deletes them', async () => {
    const rt = new PyodideRuntime()
    try {
      await rt.eval(
        "import os; os.makedirs('/tmp/a', exist_ok=True); os.makedirs('/tmp/b', exist_ok=True)",
      )
      const before = await rt.eval('import os; os.getcwd()')
      for (const code of [
        'import os; os.chdir = lambda _: None',
        "import os; del os.chdir; raise ValueError('expected')",
        "import os; os.getcwd = lambda: '/missing-cwd'",
        "import os; del os.getcwd; raise ValueError('expected')",
      ]) {
        await rt.run({ code, args: [], env: {}, stdin: null, cwd: PathSpec.fromStrPath('/tmp/a') })
        expect((await rt.eval('import os; os.getcwd()')).value).toBe(before.value)
        const next = await rt.run({
          code: 'from pathlib import Path; print(Path.cwd())',
          args: [],
          env: {},
          stdin: null,
          cwd: PathSpec.fromStrPath('/tmp/b'),
        })
        expect(next.exitCode).toBe(0)
        expect(new TextDecoder().decode(next.stdout)).toBe('/tmp/b\n')
      }
    } finally {
      await rt.close()
    }
  })

  it('isolates queued runs and restores cwd after success and errors', async () => {
    const rt = new PyodideRuntime()
    try {
      await rt.eval(
        "import os; os.makedirs('/tmp/a', exist_ok=True); os.makedirs('/tmp/b', exist_ok=True)",
      )
      const before = await rt.eval('import os; os.getcwd()')
      if (typeof before.value !== 'string') throw new Error('cwd must be a string')
      const results = await Promise.all(
        ['/tmp/a', '/tmp/b'].map((cwd) =>
          rt.run({
            code: "import os; print(os.getcwd()); os.chdir('/tmp'); raise ValueError('expected')",
            args: [],
            env: { PWD: '/wrong' },
            stdin: null,
            cwd: PathSpec.fromStrPath(cwd),
          }),
        ),
      )
      expect(results.map((r) => new TextDecoder().decode(r.stdout))).toEqual([
        '/tmp/a\n',
        '/tmp/b\n',
      ])
      expect(results.map((r) => r.exitCode)).toEqual([1, 1])
      expect((await rt.eval('import os; os.getcwd()')).value).toBe(before.value)
      const missing = await rt.run({
        code: "print('must not run')",
        args: [],
        env: {},
        stdin: null,
        cwd: PathSpec.fromStrPath('/missing-cwd'),
      })
      expect(missing.exitCode).toBe(1)
      expect(new TextDecoder().decode(missing.stdout)).toBe('')
      const fresh = await rt.run({
        code: 'import os; print(os.getcwd())',
        args: [],
        env: {},
        stdin: null,
      })
      expect(new TextDecoder().decode(fresh.stdout)).toBe(`${before.value}\n`)
    } finally {
      await rt.close()
    }
  })
})
