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

from mirage.accessor.github import GitHubAccessor
from mirage.cache.index import IndexCacheStore
from mirage.commands.builtin.constants import PatternType
from mirage.commands.builtin.generic.grep import grep as generic_grep
from mirage.commands.builtin.grep_helper import classify_pattern
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.github.constants import SCOPE_ERROR, SCOPE_WARN
from mirage.core.github.glob import resolve_glob
from mirage.core.github.read import read as github_read
from mirage.core.github.readdir import readdir as github_readdir
from mirage.core.github.scope import (count_scope_files, is_repo_root,
                                      scope_relative_key, should_use_search)
from mirage.core.github.search import narrow_paths
from mirage.core.github.stat import stat as github_stat
from mirage.io.types import ByteSource, IOResult
from mirage.provision import ProvisionResult
from mirage.types import PathSpec


async def _estimate_recursive(index, path: str) -> tuple[int, int]:
    prefix = path.rstrip("/") + "/"
    total = 0
    ops = 0
    for entry_path, entry in index._entries.items():
        if entry.resource_type != "file":
            continue
        if not entry_path.startswith(prefix):
            continue
        total += entry.size or 0
        ops += 1
    return total, ops


async def grep_provision(
    accessor: GitHubAccessor,
    paths: list[PathSpec],
    *texts: str,
    r: bool = False,
    R: bool = False,
    index: IndexCacheStore = None,
    **_extra: object,
) -> ProvisionResult:
    if not paths or index is None:
        return ProvisionResult(command="grep " + " ".join(texts))
    recursive = r or R
    total = 0
    ops = 0
    for p in paths:
        p_prefix = p.prefix if isinstance(p, PathSpec) else ""
        key = p.original if isinstance(p, PathSpec) else str(p)
        if p_prefix and key.startswith(p_prefix):
            key = key[len(p_prefix):] or "/"
        result = await index.get(key)
        if result.entry is None:
            continue
        if result.entry.resource_type == "folder":
            if recursive:
                t, o = await _estimate_recursive(index, key)
                total += t
                ops += o
        else:
            total += result.entry.size or 0
            ops += 1
    return ProvisionResult(
        command=f"grep {texts[0] if texts else ''} ...",
        network_read_low=total,
        network_read_high=total,
        read_ops=ops,
    )


@command("grep",
         resource="github",
         spec=SPECS["grep"],
         provision=grep_provision)
async def grep(
    accessor: GitHubAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    r: bool = False,
    R: bool = False,
    i: bool = False,
    v: bool = False,
    n: bool = False,
    c: bool = False,
    args_l: bool = False,
    w: bool = False,
    F: bool = False,
    E: bool = False,
    o: bool = False,
    m: str | None = None,
    q: bool = False,
    H: bool = False,
    args_h: bool = False,
    A: str | None = None,
    B: str | None = None,
    C: str | None = None,
    e: str | None = None,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if e is not None:
        pattern = e
    elif texts:
        pattern = texts[0]
    else:
        raise ValueError("grep: usage: grep [flags] pattern [path]")
    max_count = int(m) if m is not None else None
    after_ctx = int(A) if A is not None else (int(C) if C is not None else 0)
    before_ctx = int(B) if B is not None else (int(C) if C is not None else 0)

    resolved: list[PathSpec] = []
    if paths and index is not None:
        key = scope_relative_key(paths[0])
        file_count = count_scope_files(index._entries, key)
        pt = classify_pattern(pattern, F)
        use_search = (should_use_search(
            is_regex=(pt == PatternType.REGEX),
            recursive=(r or R),
            on_default_branch=(accessor.ref == accessor.default_branch),
        ) and is_repo_root(key) and file_count > SCOPE_WARN)
        if use_search:
            narrowed = await narrow_paths(accessor.config, accessor.owner,
                                          accessor.repo, pattern, paths)
            if narrowed:
                resolved = narrowed
                file_count = len(narrowed)
            else:
                resolved = await resolve_glob(accessor, paths, index)
        else:
            resolved = await resolve_glob(accessor, paths, index)
        if file_count > SCOPE_ERROR:
            msg = f"grep: {file_count} files in scope, narrow the path\n"
            return b"", IOResult(exit_code=1, stderr=msg.encode())

    return await generic_grep(
        resolved,
        pattern=pattern,
        readdir=github_readdir,
        stat=github_stat,
        read_bytes=github_read,
        read_stream=None,
        accessor=accessor,
        stdin=stdin,
        ignore_case=i,
        invert=v,
        line_numbers=n,
        count_only=c,
        files_only=args_l,
        whole_word=w,
        fixed_string=F,
        only_matching=o,
        quiet=q,
        recursive=r or R,
        max_count=max_count,
        after_context=after_ctx,
        before_context=before_ctx,
        index=index,
    )
