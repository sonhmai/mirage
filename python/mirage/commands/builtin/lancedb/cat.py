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

from mirage.accessor.lancedb import LanceDBAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.cat import cat as generic_cat
from mirage.commands.builtin.lancedb._provision import metadata_provision
from mirage.commands.builtin.utils.stream import _resolve_source
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.lancedb.glob import resolve_glob
from mirage.core.lancedb.read import read as lancedb_read
from mirage.io.stream import async_chain
from mirage.io.types import ByteSource, IOResult
from mirage.provision.types import ProvisionResult
from mirage.types import PathSpec


async def cat_provision(
    accessor: LanceDBAccessor,
    paths: list[PathSpec],
    *texts: str,
    **_extra: object,
) -> ProvisionResult:
    return await metadata_provision("cat " + " ".join(
        p.original if isinstance(p, PathSpec) else p for p in paths))


@command("cat", resource="lancedb", spec=SPECS["cat"], provision=cat_provision)
async def cat(
    accessor: LanceDBAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    n: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if paths:
        paths = await resolve_glob(accessor, paths, index)
        reads: dict[str, ByteSource] = {}
        parts: list[bytes] = []
        for p in paths:
            data = await lancedb_read(accessor, p, index)
            reads[p.strip_prefix] = data
            parts.append(data)
        io = IOResult(reads=reads, cache=list(reads))
        source: ByteSource = parts[0] if len(parts) == 1 else async_chain(
            *parts)
        return (generic_cat(source, number_lines=True) if n else source), io
    source = _resolve_source(stdin, "cat: missing operand")
    return (generic_cat(source, number_lines=True)
            if n else source), IOResult()
