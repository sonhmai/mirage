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

import type { PathSpec } from '@struktoai/mirage-core'

export function rawPathOf(path: PathSpec): string {
  const prefix = path.prefix
  return prefix !== '' && path.original.startsWith(prefix)
    ? path.original.slice(prefix.length) || '/'
    : path.original
}

export function hfKey(rawPath: string): string {
  let start = 0
  while (start < rawPath.length && rawPath[start] === '/') start += 1
  return rawPath.slice(start)
}

export function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('NotFound')
}

export function enoent(rawPath: string): Error & { code: string } {
  const e = new Error(`HF path not found: ${rawPath}`) as Error & { code: string }
  e.code = 'ENOENT'
  return e
}
