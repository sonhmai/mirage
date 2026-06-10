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

import type { RegisteredCommand } from '../../config.ts'
import { LANCEDB_CAT } from './cat.ts'
import { LANCEDB_FIND } from './find.ts'
import { LANCEDB_GREP } from './grep.ts'
import { LANCEDB_HEAD } from './head.ts'
import { LANCEDB_LS } from './ls.ts'
import { LANCEDB_RG } from './rg.ts'
import { LANCEDB_SEARCH } from './search.ts'
import { LANCEDB_STAT } from './stat.ts'
import { LANCEDB_TAIL } from './tail.ts'
import { LANCEDB_TREE } from './tree.ts'
import { LANCEDB_WC } from './wc.ts'

export const LANCEDB_COMMANDS: readonly RegisteredCommand[] = [
  ...LANCEDB_LS,
  ...LANCEDB_STAT,
  ...LANCEDB_CAT,
  ...LANCEDB_TREE,
  ...LANCEDB_WC,
  ...LANCEDB_FIND,
  ...LANCEDB_SEARCH,
  ...LANCEDB_GREP,
  ...LANCEDB_RG,
  ...LANCEDB_HEAD,
  ...LANCEDB_TAIL,
]
