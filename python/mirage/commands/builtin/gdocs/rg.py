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

from mirage.accessor.gdocs import GDocsAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.gdocs._provision import file_read_provision
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.gdocs.glob import resolve_glob
from mirage.core.gdocs.read import read as gdocs_read
from mirage.core.gdocs.readdir import readdir as _readdir
from mirage.core.gdocs.stat import stat as _stat
from mirage.io.types import ByteSource, IOResult
from mirage.provision.types import ProvisionResult
from mirage.types import PathSpec


async def rg_provision(
    accessor: GDocsAccessor,
    paths: list[PathSpec],
    *texts: str,
    **_extra: object,
) -> ProvisionResult:
    rendered = "rg " + " ".join(texts + tuple(str(p) for p in paths))
    return await file_read_provision(accessor, paths, rendered)


@command("rg", resource="gdocs", spec=SPECS["rg"], provision=rg_provision)
async def rg(
    accessor: GDocsAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    prefix: str = "",
    index: IndexCacheStore = None,
    **flags: object,
) -> tuple[ByteSource | None, IOResult]:

    resolved = await resolve_glob(accessor, paths, index) if paths else []

    return await generic_rg(
        resolved,
        texts,
        flags,
        readdir=_readdir,
        stat=_stat,
        read_bytes=gdocs_read,
        read_stream=None,
        accessor=accessor,
        stdin=stdin,
        index=index,
    )
