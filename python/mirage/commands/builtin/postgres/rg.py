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

from mirage.accessor.postgres import PostgresAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.builtin.utils.output import format_records
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.postgres.glob import resolve_glob
from mirage.core.postgres.read import read as postgres_read
from mirage.core.postgres.readdir import readdir as _readdir
from mirage.core.postgres.scope import detect_scope
from mirage.core.postgres.search import (format_grep_results, search_database,
                                         search_entity, search_kind,
                                         search_schema)
from mirage.core.postgres.stat import stat as _stat
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("rg", resource="postgres", spec=SPECS["rg"])
async def rg(
    accessor: PostgresAccessor,
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

        if scope.level == "root":
            results = await search_database(accessor, pattern_str, limit)
            all_lines = format_grep_results(results)
            if not all_lines:
                return b"", IOResult(exit_code=1)
            return format_records(all_lines), IOResult()

        if scope.level == "schema":
            results = await search_schema(accessor, scope.schema, pattern_str,
                                          limit)
            all_lines = format_grep_results(results)
            if not all_lines:
                return b"", IOResult(exit_code=1)
            return format_records(all_lines), IOResult()

        if scope.level == "kind":
            results = await search_kind(accessor, scope.schema, scope.kind,
                                        pattern_str, limit)
            all_lines = format_grep_results(results)
            if not all_lines:
                return b"", IOResult(exit_code=1)
            return format_records(all_lines), IOResult()

        if scope.level in ("entity", "entity_rows"):
            rows = await search_entity(accessor, scope.schema, scope.kind,
                                       scope.entity, pattern_str, limit)
            if not rows:
                return b"", IOResult(exit_code=1)
            results = [(scope.schema, scope.kind, scope.entity, rows)]
            all_lines = format_grep_results(results)
            return format_records(all_lines), IOResult()

        paths = await resolve_glob(accessor, paths, index=index)

    return await generic_rg(
        paths,
        pattern=pattern_str,
        readdir=_readdir,
        stat=_stat,
        read_bytes=postgres_read,
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
