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
from mirage.commands.builtin.generic.rg import rg as generic_rg
from mirage.commands.builtin.grep_helper import classify_pattern
from mirage.commands.registry import command
from mirage.commands.spec import SPECS
from mirage.core.github.constants import SCOPE_ERROR, SCOPE_WARN
from mirage.core.github.glob import resolve_glob
from mirage.core.github.read import read as github_read
from mirage.core.github.readdir import readdir as _readdir
from mirage.core.github.scope import (count_scope_files, is_repo_root,
                                      scope_relative_key, should_use_search)
from mirage.core.github.search import narrow_paths
from mirage.core.github.stat import stat as _stat
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec


@command("rg", resource="github", spec=SPECS["rg"])
async def rg(
    accessor: GitHubAccessor,
    paths: list[PathSpec],
    *texts: str,
    stdin: AsyncIterator[bytes] | bytes | None = None,
    i: bool = False,
    v: bool = False,
    n: bool = False,
    c: bool = False,
    args_l: bool = False,
    w: bool = False,
    F: bool = False,
    o: bool = False,
    m: str | None = None,
    A: str | None = None,
    B: str | None = None,
    C: str | None = None,
    hidden: bool = False,
    type: str | None = None,
    glob: str | None = None,
    index: IndexCacheStore = None,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    if not texts:
        raise ValueError("rg: usage: rg [flags] pattern [path]")
    pattern_str = texts[0]
    max_count = int(m) if m is not None else None
    after_ctx = int(A) if A is not None else (int(C) if C is not None else 0)
    before_ctx = int(B) if B is not None else (int(C) if C is not None else 0)

    if paths and index is None:
        return b"", IOResult(exit_code=1)
    if paths:
        key = scope_relative_key(paths[0])
        file_count = count_scope_files(index._entries, key)
        pt = classify_pattern(pattern_str, F)
        use_search = (should_use_search(
            is_regex=(pt == PatternType.REGEX),
            recursive=True,
            on_default_branch=(accessor.ref == accessor.default_branch),
        ) and is_repo_root(key) and file_count > SCOPE_WARN)
        if use_search:
            narrowed = await narrow_paths(accessor.config, accessor.owner,
                                          accessor.repo, pattern_str, paths)
            if narrowed:
                paths = narrowed
                file_count = len(narrowed)
            else:
                paths = await resolve_glob(accessor, paths, index)
        else:
            paths = await resolve_glob(accessor, paths, index)
        if file_count > SCOPE_ERROR:
            msg = f"rg: {file_count} files in scope, narrow the path\n"
            return b"", IOResult(exit_code=1, stderr=msg.encode())

    return await generic_rg(
        paths,
        pattern=pattern_str,
        readdir=_readdir,
        stat=_stat,
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
        max_count=max_count,
        context_before=before_ctx,
        context_after=after_ctx,
        hidden=hidden,
        file_type=type,
        glob_pattern=glob,
        index=index,
    )
