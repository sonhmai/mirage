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

from mirage.accessor.ram import RAMAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.aggregators import concat_aggregate
from mirage.commands.builtin.generic.cat import cat as generic_cat
from mirage.commands.builtin.utils.stream import _resolve_source
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.ram.glob import resolve_glob
from mirage.core.ram.stat import stat as _stat_async
from mirage.core.ram.stream import stream as _stream_core
from mirage.io.cachable_iterator import CachableAsyncIterator
from mirage.io.stream import chain_cachables
from mirage.io.types import ByteSource, IOResult
from mirage.provision import ProvisionResult
from mirage.types import PathSpec


async def cat_provision(
    accessor: RAMAccessor = None,
    paths: list[PathSpec] | None = None,
    *texts: str,
    **_extra: object,
) -> ProvisionResult:
    if not paths or accessor.store is None:
        return ProvisionResult(command="cat")
    s = await _stat_async(accessor, paths[0])
    return ProvisionResult(
        command=f"cat {paths[0].original}",
        network_read_low=s.size,
        network_read_high=s.size,
        read_ops=1,
    )


@command("cat",
         resource="ram",
         spec=SPECS["cat"],
         provision=cat_provision,
         aggregate=concat_aggregate)
async def cat(
    accessor: RAMAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    n: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if paths and accessor.store is not None:
        paths = await resolve_glob(accessor, paths, index)
        for p in paths:
            await _stat_async(accessor, p)
        # One path: stream lazily and record the same cachable so the
        # cache captures exactly this file's bytes. Multiple paths: a
        # shared cachable of the joined stream would cache the full
        # concatenation under every key, so record one cachable per
        # file and chain them with buffer replay (lazy, early-stop
        # safe, and apply_io drains attribute correctly per file).
        if len(paths) == 1:
            p = paths[0]
            cachable = CachableAsyncIterator(_stream_core(accessor, p))
            io = IOResult(reads={p.strip_prefix: cachable},
                          cache=[p.strip_prefix])
            source: ByteSource = cachable
        else:
            cachables = [
                CachableAsyncIterator(_stream_core(accessor, p)) for p in paths
            ]
            io = IOResult(reads={
                p.strip_prefix: c
                for p, c in zip(paths, cachables)
            },
                          cache=[p.strip_prefix for p in paths])
            source = chain_cachables(*cachables)
        if n:
            return generic_cat(source, number_lines=True), io
        return source, io
    source = _resolve_source(stdin, "cat: missing operand")
    if n:
        return generic_cat(source, number_lines=True), IOResult()
    return source, IOResult()
