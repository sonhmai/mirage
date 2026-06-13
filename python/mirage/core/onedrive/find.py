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
from collections.abc import AsyncIterator

import aiohttp

from mirage.accessor.onedrive import OneDriveAccessor
from mirage.core.onedrive._client import (graph_list, item_url, new_session,
                                          split_path)
from mirage.types import PathSpec


async def iter_tree(
    config,
    base: str,
    session: aiohttp.ClientSession | None = None,
) -> AsyncIterator[tuple[str, dict, bool]]:
    url = item_url(config, "/" + base if base else "/", action="/children")
    children = await graph_list(config, url, session=session)
    for child in children:
        cname = child.get("name", "")
        rel = f"{base}/{cname}" if base else cname
        is_dir = "folder" in child
        yield rel, child, is_dir
        if is_dir:
            async for entry in iter_tree(config, rel, session=session):
                yield entry


async def find(
    accessor: OneDriveAccessor,
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
    path_pattern: str | None = None,
    mindepth: int | None = None,
) -> list[str]:
    _, base = split_path(path)
    results: list[str] = []
    async with new_session(accessor.config) as session:
        async for rel, item, is_dir in iter_tree(accessor.config,
                                                 base,
                                                 session=session):
            relative = rel[len(base):].lstrip("/") if base else rel
            depth = relative.count("/") + 1
            if maxdepth is not None and depth > maxdepth:
                continue
            if mindepth is not None and depth < mindepth:
                continue
            entry_name = rel.rsplit("/", 1)[-1]
            if or_names:
                if not any(fnmatch.fnmatch(entry_name, p) for p in or_names):
                    continue
            elif name and not fnmatch.fnmatch(entry_name, name):
                continue
            if iname is not None and not fnmatch.fnmatch(
                    entry_name.lower(), iname.lower()):
                continue
            full_path = "/" + rel
            if path_pattern is not None and not fnmatch.fnmatch(
                    full_path, path_pattern):
                continue
            if name_exclude and fnmatch.fnmatch(entry_name, name_exclude):
                continue
            if type == "file" and is_dir:
                continue
            if type == "directory" and not is_dir:
                continue
            size = item.get("size", 0)
            if min_size is not None and size < min_size:
                continue
            if max_size is not None and size > max_size:
                continue
            results.append(full_path)
    return sorted(results)
