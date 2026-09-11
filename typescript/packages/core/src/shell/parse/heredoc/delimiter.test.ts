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

import { describe, expect, it } from 'vitest'
import { cleanDelimiter } from './delimiter.ts'

describe('cleanDelimiter', () => {
  it.each([
    ['EOF', 'EOF'],
    ["'EOF'", 'EOF'],
    ['"EOF"', 'EOF'],
    ["EN'D'", 'END'],
    ['\\EOF', 'EOF'],
    ['E\\OF', 'EOF'],
    ['E\\$F', 'E$F'],
    ["'EO F'", 'EO F'],
    ["'E\\xF'", 'E\\xF'],
    ["'E\\$F'", 'E\\$F'],
    ['"E\\$F"', 'E$F'],
    ['"E\\"F"', 'E"F'],
    ['"E\\`F"', 'E`F'],
    ['"E\\\\F"', 'E\\F'],
    ['"E\\xF"', 'E\\xF'],
    ["E'", 'E'],
  ])('reads %j as %j', (token, expected) => {
    expect(cleanDelimiter(token)).toBe(expected)
  })
})
