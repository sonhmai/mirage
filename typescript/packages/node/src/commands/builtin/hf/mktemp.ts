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

import { command, mktempGeneric, specOf } from '@struktoai/mirage-core'
import type { HfAccessor } from '../../../accessor/hf.ts'
import { HF_RESOURCES } from '../../../accessor/hf.ts'
import { mkdir as hfMkdir } from '../../../core/hf/mkdir.ts'
import { write as hfWrite } from '../../../core/hf/write.ts'

export const HF_MKTEMP = command({
  name: 'mktemp',
  resource: [...HF_RESOURCES],
  spec: specOf('mktemp'),
  fn: (accessor: HfAccessor, _paths, texts, opts) =>
    mktempGeneric(
      texts,
      opts,
      (p) => hfMkdir(accessor, p),
      (p, d) => hfWrite(accessor, p, d),
    ),
  write: true,
})
