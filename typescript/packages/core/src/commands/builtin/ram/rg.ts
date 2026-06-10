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

import { readdir as ramReaddir } from '../../../core/ram/readdir.ts'
import { stat as ramStat } from '../../../core/ram/stat.ts'
import { stream as ramStream } from '../../../core/ram/stream.ts'
import type { RAMAccessor } from '../../../accessor/ram.ts'
import { ResourceName } from '../../../types.ts'
import { command } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { rgGeneric } from '../generic/rg.ts'

export const RAM_RG = command({
  name: 'rg',
  resource: ResourceName.RAM,
  spec: specOf('rg'),
  fn: (accessor: RAMAccessor, paths, texts, opts) =>
    rgGeneric(
      paths,
      texts,
      opts,
      (p) => ramStat(accessor, p),
      (p) => ramReaddir(accessor, p),
      (p) => ramStream(accessor, p),
    ),
})
