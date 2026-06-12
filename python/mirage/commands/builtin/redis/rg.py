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

from mirage.accessor.redis import RedisAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.redis.glob import resolve_glob
from mirage.core.redis.read import read as _read
from mirage.core.redis.readdir import readdir as _readdir
from mirage.core.redis.stat import stat as _stat
from mirage.core.redis.stream import stream as _read_stream
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("rg", resource="redis", spec=SPECS["rg"])
async def rg(
    accessor: RedisAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    index: IndexCacheStore = None,
    **flags: object,
) -> tuple[ByteSource | None, IOResult]:

    if paths and accessor.store is not None:
        paths = await resolve_glob(accessor, paths, index)

    return await generic_rg(
        paths,
        texts,
        flags,
        readdir=_readdir,
        stat=_stat,
        read_bytes=_read,
        read_stream=_read_stream,
        accessor=accessor,
        stdin=stdin,
        index=index,
    )
