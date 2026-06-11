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

import fnmatch

from mirage.accessor.github import GitHubAccessor
from mirage.cache.index import IndexCacheStore
from mirage.types import PathSpec


def _matches(
    full_path: str,
    entry_name: str,
    is_dir: bool,
    size: int,
    name: str | None,
    type: str | None,
    min_size: int | None,
    max_size: int | None,
    name_exclude: str | None,
    or_names: list[str] | None,
    iname: str | None,
    path_pattern: str | None,
) -> bool:
    if type in ("f", "file") and is_dir:
        return False
    if type in ("d", "directory") and not is_dir:
        return False
    if or_names:
        if not any(fnmatch.fnmatch(entry_name, n) for n in or_names):
            return False
    elif name and not fnmatch.fnmatch(entry_name, name):
        return False
    if iname and not fnmatch.fnmatch(entry_name.lower(), iname.lower()):
        return False
    if path_pattern and not fnmatch.fnmatch(full_path, path_pattern):
        return False
    if name_exclude and fnmatch.fnmatch(entry_name, name_exclude):
        return False
    if min_size is not None and size < min_size:
        return False
    if max_size is not None and size > max_size:
        return False
    return True


async def find(
    accessor: GitHubAccessor,
    path: PathSpec,
    name: str | None = None,
    type: str | None = None,
    min_size: int | None = None,
    max_size: int | None = None,
    maxdepth: int | None = None,
    name_exclude: str | None = None,
    or_names: list[str] | None = None,
    mtime_min: float | None = None,
    mtime_max: float | None = None,
    iname: str | None = None,
    mindepth: int | None = None,
    path_pattern: str | None = None,
    index: IndexCacheStore = None,
) -> list[str]:
    if isinstance(path, str):
        path = PathSpec(original=path, directory=path)
    if index is None:
        raise ValueError("find: no tree loaded")
    base = path.strip_prefix.strip("/")
    base_depth = 0 if base == "" else base.count("/") + 1
    results: list[str] = []
    for entry_path in sorted(index._entries):
        p = entry_path.lstrip("/")
        if p != base and not p.startswith(base + "/" if base else ""):
            continue
        entry = index._entries[entry_path]
        is_dir = entry.resource_type == "folder"
        full_path = "/" + p
        depth = p.count("/") + 1 - base_depth
        if maxdepth is not None and depth > maxdepth:
            continue
        if mindepth is not None and depth < mindepth:
            continue
        entry_name = p.rsplit("/", 1)[-1]
        if _matches(full_path, entry_name, is_dir, entry.size or 0, name,
                    type, min_size, max_size, name_exclude, or_names, iname,
                    path_pattern):
            results.append(full_path)
    return results
