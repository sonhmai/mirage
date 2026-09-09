import { Accessor } from './base.ts'
import { WandbClient } from '../core/wandb/client.ts'
import type { WandbConfig } from '../core/wandb/config.ts'
export class WandbAccessor extends Accessor {
  readonly client: WandbClient
  constructor(readonly config: WandbConfig) {
    super()
    this.client = new WandbClient(config)
  }
}
