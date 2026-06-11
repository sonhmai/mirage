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

import type { OpKwargs, PathSpec, RegisteredOp } from '@struktoai/mirage-core'
import { HF_RESOURCES, type HfAccessor } from '../../accessor/hf.ts'
import { readdir as coreReaddir } from '../../core/hf/readdir.ts'

export const readdirOps: readonly RegisteredOp[] = HF_RESOURCES.map((resource) => ({
  name: 'readdir',
  resource,
  filetype: null,
  write: false,
  fn: (accessor: HfAccessor, path: PathSpec, _args: readonly unknown[], kwargs: OpKwargs) => {
    return coreReaddir(accessor, path, kwargs.index)
  },
}))
