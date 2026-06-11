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
import { DATABRICKS_VOLUME_AWK } from './awk.ts'
import { DATABRICKS_VOLUME_CAT } from './cat.ts'
import { DATABRICKS_VOLUME_CP } from './cp.ts'
import { DATABRICKS_VOLUME_CUT } from './cut.ts'
import { DATABRICKS_VOLUME_DIFF } from './diff.ts'
import { DATABRICKS_VOLUME_FIND } from './find.ts'
import { DATABRICKS_VOLUME_GREP } from './grep.ts'
import { DATABRICKS_VOLUME_HEAD } from './head.ts'
import { DATABRICKS_VOLUME_JQ } from './jq.ts'
import { DATABRICKS_VOLUME_LS } from './ls.ts'
import { DATABRICKS_VOLUME_MKDIR } from './mkdir.ts'
import { DATABRICKS_VOLUME_MV } from './mv.ts'
import { DATABRICKS_VOLUME_NL } from './nl.ts'
import { DATABRICKS_VOLUME_RG } from './rg.ts'
import { DATABRICKS_VOLUME_RM } from './rm.ts'
import { DATABRICKS_VOLUME_SED } from './sed.ts'
import { DATABRICKS_VOLUME_SORT } from './sort.ts'
import { DATABRICKS_VOLUME_STAT } from './stat.ts'
import { DATABRICKS_VOLUME_TAIL } from './tail.ts'
import { DATABRICKS_VOLUME_TOUCH } from './touch.ts'
import { DATABRICKS_VOLUME_TR } from './tr.ts'
import { DATABRICKS_VOLUME_TREE } from './tree.ts'
import { DATABRICKS_VOLUME_UNIQ } from './uniq.ts'
import { DATABRICKS_VOLUME_WC } from './wc.ts'

export const DATABRICKS_VOLUME_COMMANDS: readonly RegisteredCommand[] = [
  ...DATABRICKS_VOLUME_AWK,
  ...DATABRICKS_VOLUME_CAT,
  ...DATABRICKS_VOLUME_CP,
  ...DATABRICKS_VOLUME_CUT,
  ...DATABRICKS_VOLUME_DIFF,
  ...DATABRICKS_VOLUME_FIND,
  ...DATABRICKS_VOLUME_GREP,
  ...DATABRICKS_VOLUME_HEAD,
  ...DATABRICKS_VOLUME_JQ,
  ...DATABRICKS_VOLUME_LS,
  ...DATABRICKS_VOLUME_MKDIR,
  ...DATABRICKS_VOLUME_MV,
  ...DATABRICKS_VOLUME_NL,
  ...DATABRICKS_VOLUME_RG,
  ...DATABRICKS_VOLUME_RM,
  ...DATABRICKS_VOLUME_SED,
  ...DATABRICKS_VOLUME_SORT,
  ...DATABRICKS_VOLUME_STAT,
  ...DATABRICKS_VOLUME_TAIL,
  ...DATABRICKS_VOLUME_TOUCH,
  ...DATABRICKS_VOLUME_TR,
  ...DATABRICKS_VOLUME_TREE,
  ...DATABRICKS_VOLUME_UNIQ,
  ...DATABRICKS_VOLUME_WC,
]
