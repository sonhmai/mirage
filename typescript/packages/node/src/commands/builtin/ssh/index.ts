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
import { SSH_BASENAME } from './basename.ts'
import { SSH_CAT } from './cat/cat.ts'
import { SSH_CP } from './cp.ts'
import { SSH_DIRNAME } from './dirname.ts'
import { SSH_DU } from './du.ts'
import { SSH_FILE } from './file/file.ts'
import { SSH_FIND } from './find.ts'
import { SSH_GREP } from './grep/grep.ts'
import { SSH_HEAD } from './head/head.ts'
import { SSH_JQ } from './jq.ts'
import { SSH_LS } from './ls/ls.ts'
import { SSH_MKDIR } from './mkdir.ts'
import { SSH_MV } from './mv.ts'
import { SSH_REALPATH } from './realpath.ts'
import { SSH_RG } from './rg.ts'
import { SSH_RM } from './rm.ts'
import { SSH_STAT } from './stat/stat.ts'
import { SSH_TAIL } from './tail/tail.ts'
import { SSH_TOUCH } from './touch.ts'
import { SSH_TREE } from './tree.ts'
import { SSH_WC } from './wc/wc.ts'
import { SSH_AWK } from './awk.ts'
import { SSH_BASE64 } from './base64_cmd.ts'
import { SSH_CMP } from './cmp.ts'
import { SSH_COLUMN } from './column.ts'
import { SSH_COMM } from './comm.ts'
import { SSH_CSPLIT } from './csplit.ts'
import { SSH_CUT } from './cut.ts'
import { SSH_DIFF } from './diff.ts'
import { SSH_EXPAND } from './expand.ts'
import { SSH_FMT } from './fmt.ts'
import { SSH_FOLD } from './fold.ts'
import { SSH_GUNZIP } from './gunzip.ts'
import { SSH_GZIP } from './gzip.ts'
import { SSH_ICONV } from './iconv.ts'
import { SSH_JOIN } from './join.ts'
import { SSH_LN } from './ln.ts'
import { SSH_LOOK } from './look.ts'
import { SSH_MD5 } from './md5.ts'
import { SSH_MKTEMP } from './mktemp.ts'
import { SSH_NL } from './nl.ts'
import { SSH_PASTE } from './paste.ts'
import { SSH_PATCH } from './patch.ts'
import { SSH_READLINK } from './readlink.ts'
import { SSH_REV } from './rev.ts'
import { SSH_SED } from './sed.ts'
import { SSH_SHA256SUM } from './sha256sum.ts'
import { SSH_SHUF } from './shuf.ts'
import { SSH_SORT } from './sort.ts'
import { SSH_SPLIT } from './split.ts'
import { SSH_STRINGS } from './strings.ts'
import { SSH_TAC } from './tac.ts'
import { SSH_TAR } from './tar.ts'
import { SSH_TEE } from './tee.ts'
import { SSH_TR } from './tr.ts'
import { SSH_TSORT } from './tsort.ts'
import { SSH_UNEXPAND } from './unexpand.ts'
import { SSH_UNIQ } from './uniq.ts'
import { SSH_UNZIP } from './unzip.ts'
import { SSH_XXD } from './xxd.ts'
import { SSH_ZCAT } from './zcat.ts'
import { SSH_ZGREP } from './zgrep.ts'
import { SSH_ZIP } from './zip_cmd.ts'

export const SSH_COMMANDS: readonly RegisteredCommand[] = [
  ...SSH_LS,
  ...SSH_TREE,
  ...SSH_CAT,
  ...SSH_HEAD,
  ...SSH_TAIL,
  ...SSH_WC,
  ...SSH_FIND,
  ...SSH_GREP,
  ...SSH_RG,
  ...SSH_STAT,
  ...SSH_JQ,
  ...SSH_DU,
  ...SSH_FILE,
  ...SSH_BASENAME,
  ...SSH_DIRNAME,
  ...SSH_REALPATH,
  ...SSH_CP,
  ...SSH_MV,
  ...SSH_RM,
  ...SSH_MKDIR,
  ...SSH_TOUCH,
  ...SSH_AWK,
  ...SSH_BASE64,
  ...SSH_CMP,
  ...SSH_COLUMN,
  ...SSH_COMM,
  ...SSH_CSPLIT,
  ...SSH_CUT,
  ...SSH_DIFF,
  ...SSH_EXPAND,
  ...SSH_FMT,
  ...SSH_FOLD,
  ...SSH_GUNZIP,
  ...SSH_GZIP,
  ...SSH_ICONV,
  ...SSH_JOIN,
  ...SSH_LN,
  ...SSH_LOOK,
  ...SSH_MD5,
  ...SSH_MKTEMP,
  ...SSH_NL,
  ...SSH_PASTE,
  ...SSH_PATCH,
  ...SSH_READLINK,
  ...SSH_REV,
  ...SSH_SED,
  ...SSH_SHA256SUM,
  ...SSH_SHUF,
  ...SSH_SORT,
  ...SSH_SPLIT,
  ...SSH_STRINGS,
  ...SSH_TAC,
  ...SSH_TAR,
  ...SSH_TEE,
  ...SSH_TR,
  ...SSH_TSORT,
  ...SSH_UNEXPAND,
  ...SSH_UNIQ,
  ...SSH_UNZIP,
  ...SSH_XXD,
  ...SSH_ZCAT,
  ...SSH_ZGREP,
  ...SSH_ZIP,
]
