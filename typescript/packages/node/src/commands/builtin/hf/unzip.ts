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

import { command, specOf, unzipGeneric } from '@struktoai/mirage-core'
import type { HfAccessor } from '../../../accessor/hf.ts'
import { HF_RESOURCES } from '../../../accessor/hf.ts'
import { stream as hfStream } from '../../../core/hf/stream.ts'
import { write as hfWrite } from '../../../core/hf/write.ts'
import { mkdir as hfMkdir } from '../../../core/hf/mkdir.ts'

export const HF_UNZIP = command({
  name: 'unzip',
  resource: [...HF_RESOURCES],
  spec: specOf('unzip'),
  fn: (accessor: HfAccessor, paths, _texts, opts) =>
    unzipGeneric(
      paths,
      opts,
      (p) => hfStream(accessor, p),
      (p, d) => hfWrite(accessor, p, d),
      (p) => hfMkdir(accessor, p),
    ),
  write: true,
})
