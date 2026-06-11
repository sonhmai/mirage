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

import type { RegisteredCommand } from '@struktoai/mirage-core'
import { HF_AWK } from './awk.ts'
import { HF_BASE64 } from './base64_cmd.ts'
import { HF_BASENAME } from './basename.ts'
import { HF_CAT } from './cat/cat.ts'
import { HF_CMP } from './cmp.ts'
import { HF_COLUMN } from './column.ts'
import { HF_COMM } from './comm.ts'
import { HF_CSPLIT } from './csplit.ts'
import { HF_CUT } from './cut.ts'
import { HF_DIFF } from './diff.ts'
import { HF_DIRNAME } from './dirname.ts'
import { HF_DU } from './du.ts'
import { HF_EXPAND } from './expand.ts'
import { HF_FILE } from './file/file.ts'
import { HF_FIND } from './find.ts'
import { HF_FMT } from './fmt.ts'
import { HF_FOLD } from './fold.ts'
import { HF_GREP } from './grep/grep.ts'
import { HF_GUNZIP } from './gunzip.ts'
import { HF_GZIP } from './gzip.ts'
import { HF_HEAD } from './head/head.ts'
import { HF_ICONV } from './iconv.ts'
import { HF_JOIN } from './join.ts'
import { HF_JQ } from './jq.ts'
import { HF_LOOK } from './look.ts'
import { HF_LS } from './ls/ls.ts'
import { HF_MD5 } from './md5.ts'
import { HF_MKTEMP } from './mktemp.ts'
import { HF_NL } from './nl.ts'
import { HF_PASTE } from './paste.ts'
import { HF_READLINK } from './readlink.ts'
import { HF_REALPATH } from './realpath.ts'
import { HF_REV } from './rev.ts'
import { HF_RG } from './rg.ts'
import { HF_RM } from './rm.ts'
import { HF_SED } from './sed.ts'
import { HF_SHA256SUM } from './sha256sum.ts'
import { HF_SHUF } from './shuf.ts'
import { HF_SORT } from './sort.ts'
import { HF_SPLIT } from './split.ts'
import { HF_STAT } from './stat/stat.ts'
import { HF_STRINGS } from './strings.ts'
import { HF_TAC } from './tac.ts'
import { HF_TAIL } from './tail/tail.ts'
import { HF_TAR } from './tar.ts'
import { HF_TOUCH } from './touch.ts'
import { HF_TR } from './tr.ts'
import { HF_TREE } from './tree.ts'
import { HF_TSORT } from './tsort.ts'
import { HF_UNEXPAND } from './unexpand.ts'
import { HF_UNIQ } from './uniq.ts'
import { HF_UNZIP } from './unzip.ts'
import { HF_WC } from './wc/wc.ts'
import { HF_XXD } from './xxd.ts'
import { HF_ZCAT } from './zcat.ts'
import { HF_ZGREP } from './zgrep.ts'
import { HF_ZIP } from './zip_cmd.ts'

export const HF_COMMANDS: readonly RegisteredCommand[] = [
  ...HF_AWK,
  ...HF_BASE64,
  ...HF_BASENAME,
  ...HF_CAT,
  ...HF_CMP,
  ...HF_COLUMN,
  ...HF_COMM,
  ...HF_CSPLIT,
  ...HF_CUT,
  ...HF_DIFF,
  ...HF_DIRNAME,
  ...HF_DU,
  ...HF_EXPAND,
  ...HF_FILE,
  ...HF_FIND,
  ...HF_FMT,
  ...HF_FOLD,
  ...HF_GREP,
  ...HF_GUNZIP,
  ...HF_GZIP,
  ...HF_HEAD,
  ...HF_ICONV,
  ...HF_JOIN,
  ...HF_JQ,
  ...HF_LOOK,
  ...HF_LS,
  ...HF_MD5,
  ...HF_MKTEMP,
  ...HF_NL,
  ...HF_PASTE,
  ...HF_READLINK,
  ...HF_REALPATH,
  ...HF_REV,
  ...HF_RG,
  ...HF_RM,
  ...HF_SED,
  ...HF_SHA256SUM,
  ...HF_SHUF,
  ...HF_SORT,
  ...HF_SPLIT,
  ...HF_STAT,
  ...HF_STRINGS,
  ...HF_TAC,
  ...HF_TAIL,
  ...HF_TAR,
  ...HF_TOUCH,
  ...HF_TR,
  ...HF_TREE,
  ...HF_TSORT,
  ...HF_UNEXPAND,
  ...HF_UNIQ,
  ...HF_UNZIP,
  ...HF_WC,
  ...HF_XXD,
  ...HF_ZCAT,
  ...HF_ZGREP,
  ...HF_ZIP,
]
