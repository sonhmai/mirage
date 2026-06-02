# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

from collections.abc import AsyncIterator

from mirage.accessor.mongodb import MongoDBAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.builtin.utils.output import format_records
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.mongodb._client import list_databases
from mirage.core.mongodb.glob import resolve_glob
from mirage.core.mongodb.read import read as mongodb_read
from mirage.core.mongodb.readdir import readdir as _readdir
from mirage.core.mongodb.scope import detect_scope
from mirage.core.mongodb.search import (format_grep_results, search_collection,
                                        search_database)
from mirage.core.mongodb.stat import stat as _stat
from mirage.core.mongodb.types import ScopeLevel
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("rg", resource="mongodb", spec=SPECS["rg"])
async def rg(
    accessor: MongoDBAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    i: bool = False,
    v: bool = False,
    n: bool = False,
    c: bool = False,
    args_l: bool = False,
    w: bool = False,
    F: bool = False,
    o: bool = False,
    m: str | None = None,
    A: str | None = None,
    B: str | None = None,
    C: str | None = None,
    hidden: bool = False,
    type: str | None = None,
    glob: str | None = None,
    prefix: str = "",
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if not texts:
        raise ValueError("rg: usage: rg [flags] pattern [path]")
    pattern_str = texts[0]
    max_count = int(m) if m is not None else None
    after_ctx = int(A) if A is not None else (int(C) if C is not None else 0)
    before_ctx = int(B) if B is not None else (int(C) if C is not None else 0)

    config = accessor.config
    limit = config.default_search_limit

    if paths:
        scope = detect_scope(paths[0])

        if scope.level in (ScopeLevel.ENTITY, ScopeLevel.DATABASE,
                           ScopeLevel.ROOT):
            entity_match = (scope.level == ScopeLevel.ENTITY and scope.database
                            and scope.name)
            if entity_match:
                docs = await search_collection(
                    accessor.client,
                    scope.database,
                    scope.name,
                    pattern_str,
                    limit=limit,
                )
                results = [(scope.database, scope.name, docs)] if docs else []
            elif scope.level == ScopeLevel.DATABASE and scope.database:
                results = await search_database(
                    accessor.client,
                    scope.database,
                    pattern_str,
                    limit=limit,
                )
            else:
                databases = await list_databases(accessor.client, config)
                results = []
                for db_name in databases:
                    results.extend(await search_database(
                        accessor.client,
                        db_name,
                        pattern_str,
                        limit=limit,
                    ))

            all_lines = format_grep_results(results)
            if not all_lines:
                return b"", IOResult(exit_code=1)
            return format_records(all_lines), IOResult()

        paths = await resolve_glob(accessor, paths, index=index)

    return await generic_rg(
        paths,
        pattern=pattern_str,
        readdir=_readdir,
        stat=_stat,
        read_bytes=mongodb_read,
        read_stream=None,
        accessor=accessor,
        stdin=stdin,
        ignore_case=i,
        invert=v,
        line_numbers=n,
        count_only=c,
        files_only=args_l,
        whole_word=w,
        fixed_string=F,
        only_matching=o,
        max_count=max_count,
        context_before=before_ctx,
        context_after=after_ctx,
        hidden=hidden,
        file_type=type,
        glob_pattern=glob,
        index=index,
    )
