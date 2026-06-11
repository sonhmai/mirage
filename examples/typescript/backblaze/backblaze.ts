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

import dotenv from 'dotenv'
import {
  MountMode,
  BackblazeResource,
  Workspace,
  resolvedBackblazeEndpoint,
  type BackblazeConfig,
} from '@struktoai/mirage-node'

dotenv.config({ path: '.env.development' })

function configFromEnv(): BackblazeConfig {
  const bucket = process.env.B2_BUCKET
  const region = process.env.B2_REGION
  const accessKeyId = process.env.B2_ACCESS_KEY_ID
  const secretAccessKey = process.env.B2_SECRET_ACCESS_KEY
  if (bucket === undefined || region === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error('B2_BUCKET, B2_REGION, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY must be set (e.g. in .env.development)')
  }
  return { bucket, region, accessKeyId, secretAccessKey }
}

async function main(): Promise<void> {
  const config = configFromEnv()
  const ws = new Workspace({ '/b2/': new BackblazeResource(config) }, { mode: MountMode.READ })
  try {
    console.log(`=== Backblaze B2 at ${resolvedBackblazeEndpoint(config)} ===`)

    let r = await ws.execute('ls /b2/')
    console.log('ls /b2/:\n' + r.stdoutText)

    r = await ws.execute("find /b2/ -name '*.json' | head -n 5")
    console.log('find *.json:\n' + r.stdoutText)

    const plan = await ws.execute('grep -m 1 mirage /b2/data/example.jsonl', { provision: true })
    console.log(`plan grep -m 1: network_read=${plan.networkRead} precision=${plan.precision}`)

    const bytes = ws.records.reduce((acc, rec) => acc + rec.bytes, 0)
    console.log(`\nStats: ${String(ws.records.length)} ops, ${String(bytes)} bytes`)
  } finally {
    await ws.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
