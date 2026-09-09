import type { WandbAccessor } from '../../../accessor/wandb.ts'
import { read, readStream } from '../../../core/wandb/read.ts'
import { readdir } from '../../../core/wandb/readdir.ts'
import { stat } from '../../../core/wandb/stat.ts'
import type { CommandIO } from '../generic_bind/index.ts'
export const WANDB_IO: CommandIO<WandbAccessor> = {
  readdir,
  readBytes: read,
  readStream,
  stat,
  isMounted: () => true,
  local: false,
  maxDuEntries: 1000,
}
