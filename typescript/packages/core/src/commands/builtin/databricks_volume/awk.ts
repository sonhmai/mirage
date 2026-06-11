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

import type { DatabricksVolumeAccessor } from '../../../accessor/databricks_volume.ts'
import { readBytes as dbxRead } from '../../../core/databricks_volume/read.ts'
import { resolveGlob } from '../../../core/databricks_volume/glob.ts'
import { readStream as dbxStream } from '../../../core/databricks_volume/stream.ts'
import { IOResult } from '../../../io/types.ts'
import { PathSpec, ResourceName } from '../../../types.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { awkStream } from '../generic/awk_helper.ts'
import { resolveSource } from '../utils/stream.ts'
import { lstripSlash } from '../../../util/slash.ts'

const ENC = new TextEncoder()
const DEC = new TextDecoder('utf-8', { fatal: false })

function stripMount(virtualPath: string, prefix: string): string {
  if (prefix !== '' && virtualPath.startsWith(prefix + '/')) {
    return '/' + lstripSlash(virtualPath.slice(prefix.length))
  }
  return virtualPath
}

async function awkCommand(
  accessor: DatabricksVolumeAccessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): Promise<CommandFnResult> {
  const resolved =
    paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : paths
  const mountPrefix = resolved[0]?.prefix ?? ''
  const fFlag = typeof opts.flags.f === 'string' ? opts.flags.f : null
  let program: string
  let dataPaths: string[]
  if (fFlag !== null) {
    const programSpec = new PathSpec({
      original: fFlag,
      directory: fFlag,
      resolved: false,
      prefix: mountPrefix,
    })
    try {
      const bytes = await dbxRead(accessor, programSpec)
      program = DEC.decode(bytes).trim()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return [null, new IOResult({ exitCode: 1, stderr: ENC.encode(`${msg}\n`) })]
    }
    dataPaths = [
      ...texts.map((t) => stripMount(t, mountPrefix)),
      ...resolved.map((p) => p.stripPrefix),
    ]
  } else if (texts.length > 0 && texts[0] !== undefined) {
    program = texts[0]
    dataPaths = resolved.map((p) => p.stripPrefix)
  } else {
    return [
      null,
      new IOResult({
        exitCode: 1,
        stderr: ENC.encode(`awk: usage: awk [-F fs] [-v var=val] 'program' [file ...]\n`),
      }),
    ]
  }
  const fs = typeof opts.flags.F === 'string' ? opts.flags.F : ' '
  const variables: Record<string, string> = {}
  if (typeof opts.flags.v === 'string' && opts.flags.v.includes('=')) {
    const [key, val] = opts.flags.v.split('=', 2)
    if (key !== undefined && val !== undefined) variables[key] = val
  }
  const cache: string[] = []
  let source: AsyncIterable<Uint8Array>
  if (dataPaths.length > 0) {
    const firstPath = dataPaths[0]
    if (firstPath === undefined) return [null, new IOResult()]
    const spec = new PathSpec({
      original: firstPath,
      directory: firstPath,
      resolved: false,
      prefix: mountPrefix,
    })
    source = dbxStream(accessor, spec)
    cache.push(firstPath)
  } else {
    try {
      source = resolveSource(opts.stdin, 'awk: missing input')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return [null, new IOResult({ exitCode: 1, stderr: ENC.encode(`${msg}\n`) })]
    }
  }
  return [awkStream(source, program, fs, variables), new IOResult({ cache })]
}

export const DATABRICKS_VOLUME_AWK = command({
  name: 'awk',
  resource: ResourceName.DATABRICKS_VOLUME,
  spec: specOf('awk'),
  fn: awkCommand,
})
