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

from mirage.accessor.notion import NotionAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.grep import grep as generic_grep
from mirage.commands.builtin.grep_helper import pattern_arg
from mirage.commands.builtin.notion._provision import file_read_provision
from mirage.commands.builtin.utils.output import format_records
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.commands.spec.types import FlagView
from mirage.core.notion.glob import resolve_glob
from mirage.core.notion.read import read as notion_read
from mirage.core.notion.readdir import readdir as _readdir
from mirage.core.notion.scope import detect_scope, scope_warning
from mirage.core.notion.search import format_grep_results, search_page_content
from mirage.core.notion.stat import stat as _stat
from mirage.io.types import ByteSource, IOResult
from mirage.provision.types import ProvisionResult
from mirage.types import PathSpec


async def grep_provision(
    accessor: NotionAccessor,
    paths: list[PathSpec],
    *texts: str,
    **_extra: object,
) -> ProvisionResult:
    rendered = "grep " + " ".join(texts + tuple(str(p) for p in paths))
    return await file_read_provision(accessor, paths, rendered)


@command("grep",
         resource="notion",
         spec=SPECS["grep"],
         provision=grep_provision)
async def grep(
    accessor: NotionAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    prefix: str = "",
    index: IndexCacheStore = None,
    **flags: object,
) -> tuple[ByteSource | None, IOResult]:
    fl = FlagView(flags)
    pattern = pattern_arg(texts, fl)
    max_count = fl.int("m")

    if paths and pattern is not None:
        scope = detect_scope(paths[0])
        if scope.use_native:
            file_prefix = paths[0].prefix or ""
            results = await search_page_content(
                accessor.config,
                pattern,
                page_size=max_count or 100,
            )
            lines = format_grep_results(results, file_prefix)
            if not lines:
                return b"", IOResult(exit_code=1)
            return format_records(lines), IOResult()

    resolved = await resolve_glob(accessor, paths, index) if paths else []
    return await generic_grep(
        resolved,
        texts,
        flags,
        readdir=_readdir,
        stat=_stat,
        read_bytes=notion_read,
        read_stream=None,
        accessor=accessor,
        stdin=stdin,
        scope_check=scope_warning,
        index=index,
    )
