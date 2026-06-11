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

import { stream as s3Stream } from '../../../core/s3/stream.ts'
import { write as s3Write } from '../../../core/s3/write.ts'
import { mkdir as s3Mkdir } from '../../../core/s3/mkdir.ts'
import type { S3Accessor } from '../../../accessor/s3.ts'
import { resolveGlob } from '../../../core/s3/glob.ts'
import { ResourceName } from '../../../types.ts'
import { command } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { tarGeneric } from '../generic/tar.ts'

export const S3_TAR = command({
  name: 'tar',
  resource: ResourceName.S3,
  spec: specOf('tar'),
  fn: async (accessor: S3Accessor, paths, _texts, opts) => {
    const resolved =
      paths.length > 0 ? await resolveGlob(accessor, paths, opts.index ?? undefined) : []
    return tarGeneric(
      resolved,
      opts,
      (p) => s3Stream(accessor, p),
      (p, data) => s3Write(accessor, p, data),
      (p) => s3Mkdir(accessor, p),
    )
  },
  write: true,
})
