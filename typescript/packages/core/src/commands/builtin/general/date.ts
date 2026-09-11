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

import type { PathSpec } from '../../../types.ts'
import type { Accessor } from '../../../accessor/base.ts'
import { IOResult } from '../../../io/types.ts'
import { parseDateExpr } from '../../../utils/dates.ts'
import { command, type CommandFnResult, type CommandOpts } from '../../config.ts'
import { specOf } from '../../spec/builtins.ts'
import { pureProvision } from '../generic_bind/provision.ts'
import { DAY_NAMES, MONTH_NAMES, formatTZOffset, pad2, pad4, strftime } from '../utils/strftime.ts'
import { extraOperandError } from '../../spec/usage.ts'
import { CommandName, FlagView } from '../../spec/types.ts'

const ENC = new TextEncoder()

// RFC 5322 (email) date format — e.g. "Mon, 21 Apr 2026 06:34:55 +0000"
function formatRFC5322(dt: Date, utc: boolean): string {
  const dow = utc ? dt.getUTCDay() : dt.getDay()
  const day = utc ? dt.getUTCDate() : dt.getDate()
  const mon = utc ? dt.getUTCMonth() : dt.getMonth()
  const year = utc ? dt.getUTCFullYear() : dt.getFullYear()
  const hour = utc ? dt.getUTCHours() : dt.getHours()
  const minute = utc ? dt.getUTCMinutes() : dt.getMinutes()
  const second = utc ? dt.getUTCSeconds() : dt.getSeconds()
  const tz = utc ? '+0000' : formatTZOffset(dt)
  return `${DAY_NAMES[dow] ?? ''}, ${pad2(day)} ${MONTH_NAMES[mon] ?? ''} ${pad4(year)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)} ${tz}`
}

function dateCommand(
  _accessor: Accessor,
  paths: PathSpec[],
  texts: string[],
  opts: CommandOpts,
): CommandFnResult {
  if (texts.length > 1) throw extraOperandError(CommandName.DATE, texts[1] ?? '')
  const fl = new FlagView(opts.flags, specOf('date'))
  const u = fl.asBool('u')
  const d = fl.asStr('d') ?? null
  // -I is short-only, so it lands on the disambiguated `args_I` dest
  // (`AMBIGUOUS_NAMES`); a plain `I` key is one the parser never emits.
  const argsI = fl.asBool('args_I')
  const R = fl.asBool('R')
  let dt: Date
  if (d !== null) {
    const parsed = parseDateExpr(d, u)
    if (parsed === null) {
      // GNU's refusal, exit 1: a NaN render with exit 0 poisons whatever
      // consumed it (the 0NaN-NaN-NaN corpus failure).
      return [
        null,
        new IOResult({ exitCode: 1, stderr: ENC.encode(`date: invalid date '${d}'\n`) }),
      ]
    }
    dt = parsed
  } else {
    dt = new Date()
  }
  let fmt: string | null = null
  for (const t of texts) {
    if (t.startsWith('+')) {
      fmt = t.slice(1)
      break
    }
  }
  let result: string
  if (argsI) {
    result = strftime(dt, '%Y-%m-%d', u)
  } else if (R) {
    result = formatRFC5322(dt, u)
  } else if (fmt !== null) {
    result = strftime(dt, fmt, u)
  } else if (u) {
    result = strftime(dt, '%a %b %d %H:%M:%S %Z %Y', u)
  } else {
    result = strftime(dt, '%a %b %d %H:%M:%S %Y', u)
  }
  return [ENC.encode(result + '\n'), new IOResult()]
}

export const GENERAL_DATE = command({
  name: 'date',
  resource: null,
  spec: specOf('date'),
  fn: dateCommand,
  provision: pureProvision,
})
