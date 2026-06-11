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

import type { S3Accessor } from '../../../accessor/s3.ts'
import { mkdir as s3Mkdir } from '../../../core/s3/mkdir.ts'
import { write as s3Write } from '../../../core/s3/write.ts'
import { ResourceName } from '../../../types.ts'
import { command } from '../../config.ts'
import { mktempGeneric } from '../generic/mktemp.ts'
import { specOf } from '../../spec/builtins.ts'

export const S3_MKTEMP = command({
  name: 'mktemp',
  resource: ResourceName.S3,
  spec: specOf('mktemp'),
  fn: (accessor: S3Accessor, _paths, texts, opts) =>
    mktempGeneric(
      texts,
      opts,
      (p) => s3Mkdir(accessor, p),
      (p, d) => s3Write(accessor, p, d),
    ),
  write: true,
})
