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

const ENC = new TextEncoder()

export function formatRecords(records: readonly string[]): Uint8Array {
  if (records.length === 0) {
    return new Uint8Array(0)
  }
  return ENC.encode(records.join('\n') + '\n')
}

export function formatOptionalRecords(records: readonly string[]): Uint8Array | null {
  const output = formatRecords(records)
  return output.length > 0 ? output : null
}

export function formatRecordText(records: readonly string[]): string {
  if (records.length === 0) {
    return ''
  }
  return records.join('\n') + '\n'
}
