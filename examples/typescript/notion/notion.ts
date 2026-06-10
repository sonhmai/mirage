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

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { MountMode, NotionResource, Workspace, type NotionConfig } from '@struktoai/mirage-node'

const __HERE = fileURLToPath(new URL('.', import.meta.url))
dotenv.config({ path: resolve(__HERE, '../../../.env.development') })

function buildConfig(): NotionConfig {
  const apiKey = process.env.NOTION_API_KEY
  if (apiKey === undefined || apiKey === '') {
    throw new Error('NOTION_API_KEY env var is required')
  }
  return { apiKey }
}

async function run(ws: Workspace, cmd: string): Promise<string> {
  console.log(`$ ${cmd}`)
  const r = await ws.execute(cmd)
  if (r.exitCode !== 0 && r.stderrText !== '') {
    console.log(`  STDERR: ${r.stderrText.slice(0, 200)}`)
  }
  const out = r.stdoutText.replace(/\s+$/, '')
  if (out !== '') {
    for (const line of out.split('\n').slice(0, 10)) console.log(`  ${line.slice(0, 200)}`)
  }
  return out
}

async function main(): Promise<void> {
  const ws = new Workspace(
    { '/notion': new NotionResource(buildConfig()) },
    { mode: MountMode.READ },
  )
  try {
    console.log('=== ls /notion/pages/ ===')
    const p0 = (await run(ws, 'ls /notion/pages/ | head -n 1')).trim()
    if (p0 === '') {
      console.log('no pages')
      return
    }
    const pagePath = `/notion/pages/${p0}`

    console.log(`\n=== cat ${pagePath}/page.json ===`)
    await run(ws, `cat "${pagePath}/page.json"`)

    console.log(`\n=== jq .title ${pagePath}/page.json ===`)
    await run(ws, `jq ".title" "${pagePath}/page.json"`)

    console.log(`\n=== jq .url ${pagePath}/page.json ===`)
    await run(ws, `jq ".url" "${pagePath}/page.json"`)

    console.log(`\n=== jq .markdown ${pagePath}/page.json ===`)
    await run(ws, `jq ".markdown" "${pagePath}/page.json"`)

    console.log(`\n=== stat ${pagePath}/page.json ===`)
    await run(ws, `stat "${pagePath}/page.json"`)

    console.log(`\n=== head -n 5 ${pagePath}/page.json ===`)
    await run(ws, `head -n 5 "${pagePath}/page.json"`)

    console.log('\n=== tree -L 1 /notion/ ===')
    await run(ws, 'tree -L 1 /notion/')

    console.log(`\n=== tree -L 1 ${pagePath}/ ===`)
    await run(ws, `tree -L 1 "${pagePath}/"`)

    console.log(`\n=== find ${pagePath}/ -name '*.json' ===`)
    await run(ws, `find "${pagePath}/" -name "*.json"`)

    console.log(`\n=== basename ${pagePath}/page.json ===`)
    await run(ws, `basename "${pagePath}/page.json"`)

    console.log(`\n=== dirname ${pagePath}/page.json ===`)
    await run(ws, `dirname "${pagePath}/page.json"`)

    console.log('\n=== notion-search --query EVO ===')
    await run(ws, 'notion-search --query EVO')

    console.log(`\n=== grep Graph ${pagePath}/*.json (page glob) ===`)
    await run(ws, `grep -c Graph "${pagePath}/"*.json`)

    console.log('\n=== rg Graph /notion/pages/ ===')
    await run(ws, 'rg -c Graph /notion/pages/')

    console.log(`\n=== ls ${pagePath}/ (children) ===`)
    const children = await run(ws, `ls "${pagePath}/"`)
    const childDirs = children
      .trim()
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith('.json'))
    if (childDirs.length > 0) {
      const child = childDirs[0]!
      console.log(`\n=== jq .title ${pagePath}/${child}/page.json (child page) ===`)
      await run(ws, `jq ".title" "${pagePath}/${child}/page.json"`)
    }

    console.log(`\n=== echo ${pagePath}/*.json (glob) ===`)
    await run(ws, `echo "${pagePath}/"*.json`)

    const records = ws.records
    const total = records.reduce((acc, r) => acc + (r.bytes ?? 0), 0)
    console.log(`\nStats: ${String(records.length)} ops, ${String(total)} bytes transferred`)
  } finally {
    await ws.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
