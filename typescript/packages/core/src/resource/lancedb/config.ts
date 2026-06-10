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

export interface LanceDBConfig {
  uri: string
  apiKey?: string
  region?: string
  hostOverride?: string
  storageOptions?: Record<string, string>
  table?: string
  groupBy?: string[]
  idColumn?: string
  titleColumn?: string
  blobColumn?: string
  blobExt?: string
  textColumn?: string
  vectorColumn?: string
  searchLimit?: number
  maxRows?: number
}

export interface LanceDBConfigResolved {
  uri: string
  apiKey: string | null
  region: string
  hostOverride: string | null
  storageOptions: Record<string, string> | null
  table: string | null
  groupBy: string[]
  idColumn: string
  titleColumn: string | null
  blobColumn: string | null
  blobExt: string
  textColumn: string | null
  vectorColumn: string | null
  searchLimit: number
  maxRows: number
}

export function resolveLanceDBConfig(config: LanceDBConfig): LanceDBConfigResolved {
  return {
    uri: config.uri,
    apiKey: config.apiKey ?? null,
    region: config.region ?? 'us-east-1',
    hostOverride: config.hostOverride ?? null,
    storageOptions: config.storageOptions ?? null,
    table: config.table ?? null,
    groupBy: config.groupBy ?? [],
    idColumn: config.idColumn ?? 'id',
    titleColumn: config.titleColumn ?? null,
    blobColumn: config.blobColumn ?? null,
    blobExt: config.blobExt ?? 'bin',
    textColumn: config.textColumn ?? null,
    vectorColumn: config.vectorColumn ?? null,
    searchLimit: config.searchLimit ?? 10,
    maxRows: config.maxRows ?? 1000,
  }
}
