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

import { HF_RESOURCES } from '../../../accessor/hf.ts'
import { command, readlinkGeneric, specOf, type Accessor } from '@struktoai/mirage-core'

export const HF_READLINK = command({
  name: 'readlink',
  resource: [...HF_RESOURCES],
  spec: specOf('readlink'),
  fn: (_accessor: Accessor, paths, texts, opts) => readlinkGeneric(paths, texts, opts),
})
