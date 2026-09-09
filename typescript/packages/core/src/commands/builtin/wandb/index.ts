import { makeGenericCommands } from '../generic_bind/index.ts'
import { WANDB_IO } from './io.ts'
export const WANDB_COMMANDS = makeGenericCommands('wandb', WANDB_IO)
