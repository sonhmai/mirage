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

import { ResourceName, command, rgGeneric, specOf } from '@struktoai/mirage-core'
import { readdir as redisReaddir } from '../../../core/redis/readdir.ts'
import { stat as redisStat } from '../../../core/redis/stat.ts'
import { stream as redisStream } from '../../../core/redis/stream.ts'
import type { RedisAccessor } from '../../../accessor/redis.ts'

export const REDIS_RG = command({
  name: 'rg',
  resource: ResourceName.REDIS,
  spec: specOf('rg'),
  fn: (accessor: RedisAccessor, paths, texts, opts) =>
    rgGeneric(
      paths,
      texts,
      opts,
      (p) => redisStat(accessor, p),
      (p) => redisReaddir(accessor, p),
      (p) => redisStream(accessor, p),
    ),
})
