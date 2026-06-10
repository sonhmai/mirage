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

import { IOResult, type ByteSource } from '../../../io/types.ts'
import { PathSpec } from '../../../types.ts'
import type { CommandFnResult, CommandOpts } from '../../config.ts'
import { rstripSlash } from '../../../util/slash.ts'

const ENC = new TextEncoder()

function randomSuffix(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)] ?? ''
  }
  return out
}

function makePathSpec(original: string): PathSpec {
  return new PathSpec({ original, directory: original, resolved: true })
}

export async function mktempGeneric(
  texts: string[],
  opts: CommandOpts,
  mkdir: (p: PathSpec, parents?: boolean) => Promise<void>,
  write: (p: PathSpec, data: Uint8Array) => Promise<void>,
): Promise<CommandFnResult> {
  const tFlag = opts.flags.t === true
  const parent = tFlag ? '/tmp' : typeof opts.flags.p === 'string' ? opts.flags.p : '/tmp'
  const templateArg = texts[0]
  const template = templateArg !== undefined && templateArg !== '' ? templateArg : 'tmp.XXXXXXXXXX'
  const xRun = /X+$/.exec(template)
  let name: string
  if (xRun !== null) {
    name = template.slice(0, xRun.index) + randomSuffix(xRun[0].length)
  } else {
    name = `${template}.${randomSuffix(8)}`
  }
  const path = `${rstripSlash(parent)}/${name}`
  await mkdir(makePathSpec(parent), true)
  if (opts.flags.d === true) {
    await mkdir(makePathSpec(path))
  } else {
    await write(makePathSpec(path), new Uint8Array(0))
  }
  const result: ByteSource = ENC.encode(path + '\n')
  return [result, new IOResult()]
}
