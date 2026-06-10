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

from functools import partial

from mirage.accessor.redis import RedisAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.generic.cp import cp as generic_cp
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.redis.copy import copy
from mirage.core.redis.find import find as find_core
from mirage.core.redis.glob import resolve_glob
from mirage.core.redis.stat import stat as stat_core
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("cp", resource="redis", spec=SPECS["cp"], write=True)
async def cp(
    accessor: RedisAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: bytes | None = None,
    r: bool = False,
    R: bool = False,
    a: bool = False,  # -a: alias for -r, no attributes in virtual fs
    f: bool = False,
    n: bool = False,
    v: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if accessor.store is None or len(paths) < 2:
        raise ValueError("cp: requires src and dst")
    paths = await resolve_glob(accessor, paths, index)
    return await generic_cp(paths,
                            copy=partial(copy, accessor),
                            find=partial(find_core, accessor),
                            find_type="f",
                            stat=partial(stat_core, accessor),
                            recursive=r or R or a,
                            n=n,
                            v=v,
                            index=index)
