import { startWandb } from './fake.ts'
import { checkArgv, parseFixture, parseFixtureRoot, parsePort } from '../kit/typescript/port.ts'

checkArgv()
const server = await startWandb(parsePort(undefined, 5093), parseFixture(), parseFixtureRoot())
console.log(`WANDB_BASE_URL=${server.base}`)
