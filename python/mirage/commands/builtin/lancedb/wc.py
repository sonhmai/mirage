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
from mirage.commands.builtin.lancedb._provision import metadata_provision
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.lancedb.glob import resolve_glob
from mirage.core.lancedb.read import read as lancedb_read
from mirage.io.types import ByteSource, IOResult
from mirage.provision.types import ProvisionResult
from mirage.types import PathSpec


async def wc_provision(
    accessor: LanceDBAccessor,
    paths: list[PathSpec],
    *texts: str,
    **_extra: object,
) -> ProvisionResult:
    return await metadata_provision("wc " + " ".join(
        p.original if isinstance(p, PathSpec) else p for p in paths))


def _count(data: bytes, args_l: bool, c: bool, w: bool) -> int:
    if c:
        return len(data)
    if w:
        return len(data.split())
    return data.count(b"\n")


@command("wc", resource="lancedb", spec=SPECS["wc"], provision=wc_provision)
async def wc(
    accessor: LanceDBAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    args_l: bool = False,
    w: bool = False,
    c: bool = False,
    m: bool = False,
    L: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if not paths:
        raise ValueError("wc: missing operand")
    paths = await resolve_glob(accessor, paths, index)
    lines: list[str] = []
    for p in paths:
        data = await lancedb_read(accessor, p, index)
        lines.append(f"{_count(data, args_l, c, w)} {p.original}")
    return ("\n".join(lines) + "\n").encode(), IOResult()
