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

import { ResourceName, command, grepGeneric, prefixAggregate, specOf } from '@struktoai/mirage-core'
import { stream as opfsStream } from '../../../../core/opfs/stream.ts'
import { stat as opfsStat } from '../../../../core/opfs/stat.ts'
import { readdir as opfsReaddir } from '../../../../core/opfs/readdir.ts'
import type { OPFSAccessor } from '../../../../accessor/opfs.ts'

export const OPFS_GREP = command({
  name: 'grep',
  resource: ResourceName.OPFS,
  spec: specOf('grep'),
  fn: (accessor: OPFSAccessor, paths, texts, opts) =>
    grepGeneric(
      'grep',
      paths,
      texts,
      opts,
      (p) => opfsStat(accessor, p),
      (p) => opfsReaddir(accessor, p),
      (p) => opfsStream(accessor, p),
    ),
  aggregate: prefixAggregate,
})
