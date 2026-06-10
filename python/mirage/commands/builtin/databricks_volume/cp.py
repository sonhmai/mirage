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

from mirage.accessor.databricks_volume import DatabricksVolumeAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.databricks_volume._helpers import \
    same_backend_file
from mirage.commands.builtin.utils.copy import (copy_targets, is_directory,
                                                path_exists)
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.databricks_volume.copy import copy as copy_core
from mirage.core.databricks_volume.glob import resolve_glob
from mirage.core.databricks_volume.stat import stat as stat_core
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("cp", resource="databricks_volume", spec=SPECS["cp"], write=True)
async def cp(
    accessor: DatabricksVolumeAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: bytes | None = None,
    r: bool = False,
    R: bool = False,
    a: bool = False,
    f: bool = False,
    n: bool = False,
    v: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if len(paths) < 2:
        raise ValueError("cp: requires src and dst")
    paths = await resolve_glob(accessor, paths, index)
    recursive = r or R or a
    stat = partial(stat_core, accessor)
    *sources, dst = paths
    dst_is_dir = await is_directory(stat, dst, index)
    writes: dict[str, bytes] = {}
    lines: list[str] = []
    errors: list[str] = []
    for src, target in copy_targets(sources, dst, dst_is_dir):
        if same_backend_file(accessor, src, target):
            errors.append(f"cp: '{src.original}' and '{target.original}' "
                          "are the same file")
            continue
        if n and await path_exists(stat, target):
            continue
        await copy_core(accessor, src, target, index, recursive=recursive)
        writes[target.strip_prefix] = b""
        if v:
            lines.append(f"'{src.original}' -> '{target.original}'")
    output = ("\n".join(lines) + "\n").encode() if lines else None
    stderr = ("\n".join(errors) + "\n").encode() if errors else None
    return output, IOResult(writes=writes,
                            stderr=stderr,
                            exit_code=1 if errors else 0)
