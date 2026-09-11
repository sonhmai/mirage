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

export type LanceRow = Record<string, unknown>

/** A test on one value's text that a capped scan counts in place of rows. */
export type ValueTest = (value: string) => boolean

export interface LanceDriver {
  listTables(): Promise<string[]>
  tableColumns(table: string): Promise<string[]>
  /**
   * The distinct values of one group column, as text.
   *
   * Without a test the limit bounds the rows, which is the ordinary capped
   * listing over the head of the table. With one it bounds the MATCHES: the
   * prefix a glob narrows the query to loses nothing, but it can let through
   * rows the glob does not match (a head cut inside an escape pair decodes to
   * a shorter value prefix) or narrow nothing at all (a head that is only the
   * escape lead), and those rows would fill the cap and hide every match past
   * it. A glob is a targeted request, so it pays a scan up to its matches
   * where the plain listing pays one window.
   */
  distinct(
    table: string,
    column: string,
    filters: Record<string, string>,
    limit: number,
    prefix?: string,
    keep?: ValueTest,
  ): Promise<string[]>
  rowsMatching(
    table: string,
    filters: Record<string, string>,
    columns: string[],
    limit: number,
    idColumn?: string,
    prefix?: string,
  ): Promise<LanceRow[]>
  rowRecord(table: string, idColumn: string, rowId: string): Promise<LanceRow | null>
  search(table: string, query: string, limit: number): Promise<LanceRow[]>
  close(): Promise<void>
}
