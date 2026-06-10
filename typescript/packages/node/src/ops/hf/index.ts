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

import type { RegisteredOp } from '@struktoai/mirage-core'
import { createOps } from './create.ts'
import { mkdirOps } from './mkdir.ts'
import { readOps } from './read/read.ts'
import { readFeatherOps } from './read/read_feather.ts'
import { readHdf5Ops } from './read/read_hdf5.ts'
import { readParquetOps } from './read/read_parquet.ts'
import { readdirOps } from './readdir.ts'
import { statOps } from './stat.ts'
import { unlinkOps } from './unlink.ts'
import { writeOps } from './write.ts'

export const HF_OPS: readonly RegisteredOp[] = [
  ...createOps,
  ...mkdirOps,
  ...readOps,
  ...readFeatherOps,
  ...readHdf5Ops,
  ...readParquetOps,
  ...readdirOps,
  ...statOps,
  ...unlinkOps,
  ...writeOps,
]
