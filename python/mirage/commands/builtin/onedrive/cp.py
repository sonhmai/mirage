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

from mirage.accessor.onedrive import OneDriveAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.onedrive.copy import copy
from mirage.core.onedrive.find import find as find_impl
from mirage.core.onedrive.glob import resolve_glob
from mirage.core.onedrive.stat import stat as stat_impl
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


async def _exists(accessor: OneDriveAccessor, path: PathSpec | str) -> bool:
    try:
        await stat_impl(accessor, path)
        return True
    except FileNotFoundError:
        return False


@command("cp", resource="onedrive", spec=SPECS["cp"], write=True)
async def cp(
    accessor: OneDriveAccessor,
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
    if len(paths) < 2:
        raise ValueError("cp: requires src and dst")
    paths = await resolve_glob(accessor, paths, index)
    recursive = r or R or a
    if recursive:
        src_base = paths[0].strip_prefix.rstrip("/")
        dst_base = paths[1].strip_prefix.rstrip("/")
        if n and await _exists(accessor, paths[1]):
            return None, IOResult()
        files = await find_impl(accessor, paths[0], type="file")
        await copy(accessor, paths[0], paths[1])
        writes = {dst_base + f[len(src_base):]: b"" for f in files}
        if v:
            lines = [f"{f} -> {dst_base + f[len(src_base):]}" for f in files]
            return ("\n".join(lines) + "\n").encode(), IOResult(writes=writes)
        return None, IOResult(writes=writes)
    if n and await _exists(accessor, paths[1]):
        return None, IOResult()
    await copy(accessor, paths[0], paths[1])
    output = None
    if v:
        output = f"{paths[0].original} -> {paths[1].original}\n".encode()
    return output, IOResult(writes={paths[1].original: b""})
