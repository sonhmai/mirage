import { WANDB_IO } from '../../commands/builtin/wandb/io.ts'
import { makeGenericOps } from '../generic/factory.ts'
export const WANDB_OPS = makeGenericOps('wandb', WANDB_IO)
