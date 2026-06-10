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

import { ResourceName, command, mktempGeneric, specOf } from '@struktoai/mirage-core'
import type { SSHAccessor } from '../../../accessor/ssh.ts'
import { mkdir as sshMkdir } from '../../../core/ssh/mkdir.ts'
import { writeBytes as sshWrite } from '../../../core/ssh/write.ts'

export const SSH_MKTEMP = command({
  name: 'mktemp',
  resource: ResourceName.SSH,
  spec: specOf('mktemp'),
  fn: (accessor: SSHAccessor, _paths, texts, opts) =>
    mktempGeneric(
      texts,
      opts,
      (p, parents) => sshMkdir(accessor, p, parents ?? false),
      (p, d) => sshWrite(accessor, p, d),
    ),
  write: true,
})
