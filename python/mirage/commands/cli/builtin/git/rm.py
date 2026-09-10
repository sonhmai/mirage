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

import asyncio
import posixpath
from dataclasses import dataclass

from dulwich.index import IndexEntry

from mirage.commands.cli.builtin.git.changes import (MODIFIED, head_entries,
                                                     work_changes)
from mirage.commands.cli.builtin.git.errors import GitError  # yapf: disable
from mirage.commands.cli.builtin.git.errors import (  # yapf: disable
    NoPathspecRemoveError, NotRecursiveError, NoWorkspaceError, PathspecError,
    RemovalRefusedError, UnknownSwitchError)
from mirage.commands.cli.builtin.git.index import read_index, write_index
from mirage.commands.cli.builtin.git.io import (remove_empty_parents,
                                                remove_file)
from mirage.commands.cli.builtin.git.pathspec import matched, repo_relative
from mirage.commands.cli.builtin.git.session import opened
from mirage.commands.cli.builtin.git.types import RepoLocation, WorkTree
from mirage.commands.cli.builtin.git.util import (  # yapf: disable
    check_operands, escaped, fatal, links_of, start_point)
from mirage.commands.cli.builtin.git.worktree import UNTRACKED_NO, scan
from mirage.commands.cli.types import CLIDoors, CLIInvocation
from mirage.commands.spec.types import FlagView
from mirage.io.stream import yield_bytes
from mirage.io.types import ByteSource, IOResult
from mirage.runtime.types import DispatchFn

Tree = dict[bytes, tuple[int, bytes]]


@dataclass(frozen=True, slots=True)
class RmFlags:
    """The parsed shape of a ``git rm`` invocation.

    Args:
        recursive (bool): ``-r``, allow a directory operand.
        cached (bool): ``--cached``, unstage only and keep the file.
        force (bool): ``-f``, remove even over uncommitted changes.
        quiet (bool): ``-q``, print no ``rm`` line per path.
        ignore_unmatch (bool): ``--ignore-unmatch``, an operand naming
            nothing is not an error.
    """
    recursive: bool
    cached: bool
    force: bool
    quiet: bool
    ignore_unmatch: bool


def parse_flags(fl: FlagView) -> RmFlags:
    """Read the raw rm flag kwargs into a frozen struct.

    Args:
        fl (FlagView): spec-validated view over the raw flag kwargs.
    """
    return RmFlags(recursive=fl.as_bool("r"),
                   cached=fl.as_bool("cached"),
                   force=fl.as_bool("force"),
                   quiet=fl.as_bool("quiet"),
                   ignore_unmatch=fl.as_bool("ignore_unmatch"))


def select(location: RepoLocation, start: str, operands: tuple[str, ...],
           tracked: set[str], flags: RmFlags) -> list[str]:
    """Which tracked paths the operands remove, in index order.

    Every operand is checked before anything is removed, which is git's
    order too: a line with one bad operand removes nothing. A directory
    is refused without ``-r`` rather than expanded, and an operand that
    names nothing tracked is a fatal unless ``--ignore-unmatch`` says
    otherwise. An untracked file is "nothing tracked": git has nothing
    to remove it from.

    Args:
        location (RepoLocation): the discovered repository.
        start (str): absolute virtual path git is running in.
        operands (tuple[str, ...]): the pathspecs as typed.
        tracked (set[str]): repository-relative paths the index holds.
        flags (RmFlags): the parsed flags.
    """
    selected: set[str] = set()
    for operand in operands:
        target = repo_relative(location, start, operand)
        if target in tracked:
            selected.add(target)
            continue
        hits = matched(tracked, target)
        if not hits:
            if flags.ignore_unmatch:
                continue
            raise PathspecError(operand)
        if not flags.recursive:
            raise NotRecursiveError(operand)
        selected |= hits
    return sorted(selected)


async def refuse_lost_work(dispatch: DispatchFn, location: RepoLocation,
                           tree: Tree, entries: dict[bytes, IndexEntry],
                           found: WorkTree, paths: list[str],
                           cached: bool) -> None:
    """Refuse a removal that would throw away uncommitted work.

    git's own three-way test per path: whether the index differs from
    HEAD, and whether the working tree differs from the index. A path
    that differs both ways is refused outright; one that differs one
    way is refused unless ``--cached`` keeps the file. A file already
    gone from the working tree has no local change to lose, which is
    what makes ``git rm <deleted>`` the way to stage a deletion. Pinned
    against git 2.50.1.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        location (RepoLocation): the discovered repository.
        tree (Tree): HEAD's tree, empty before the first commit.
        entries (dict[bytes, IndexEntry]): the index.
        found (WorkTree): what the walk of the working tree found.
        paths (list[str]): the selected paths that hold an index entry.
        cached (bool): whether ``--cached`` was given.
    """
    chosen = {path.encode(): entries[path.encode()] for path in paths}
    unstaged = await work_changes(dispatch, location.worktree, chosen, found)
    both: list[str] = []
    staged: list[str] = []
    local: list[str] = []
    for path in paths:
        entry = chosen[path.encode()]
        recorded = tree.get(path.encode())
        staged_changes = (recorded is None or recorded[1] != entry.sha
                          or recorded[0] != entry.mode)
        local_changes = unstaged.get(path) == MODIFIED
        if local_changes and staged_changes:
            both.append(path)
        elif not cached:
            if staged_changes:
                staged.append(path)
            if local_changes:
                local.append(path)
    if both or staged or local:
        raise RemovalRefusedError(both, staged, local)


async def rm(inv: CLIInvocation[None]) -> tuple[ByteSource | None, IOResult]:
    """Remove paths from the index, and from the working tree too.

    ``--cached`` leaves the file where it is and only stops tracking it.
    Without ``-f`` a path carrying uncommitted work is refused rather
    than deleted, which is the one check that makes the verb safe to
    hand an agent: there is no reflog here to recover a file from.

    Args:
        inv (CLIInvocation[None]): the line's invocation record.
            git declares no config_model; the planes it reads
            (data through ``dispatch``, names through ``ns``) ride
            ``inv.doors``.
    """
    doors = inv.doors or CLIDoors()
    dispatch = doors.dispatch
    stat_path = doors.stat_path
    texts = inv.texts
    fl = FlagView(inv.flags)
    try:
        if dispatch is None or stat_path is None:
            raise NoWorkspaceError()
        check_operands(texts, UnknownSwitchError, escaped(inv.argv))
        flags = parse_flags(fl)
        if not texts:
            raise NoPathspecRemoveError()
        repo, location = await opened(fl, doors)
        state = await read_index(dispatch, location.gitdir)
        tracked = {
            path.decode("utf-8", errors="replace")
            for path in (set(state.entries) | set(state.conflicts))
        }
        selected = select(location, start_point(fl), texts, tracked, flags)
        if not flags.force:
            checkable = [
                path for path in selected if path.encode() in state.entries
            ]
            found = await scan(dispatch, stat_path, location, tracked,
                               UNTRACKED_NO, links_of(doors))
            tree = await asyncio.to_thread(head_entries, repo) or {}
            await refuse_lost_work(dispatch, location, tree, state.entries,
                                   found, checkable, flags.cached)
        for path in selected:
            state.entries.pop(path.encode(), None)
            state.conflicts.pop(path.encode(), None)
        await write_index(dispatch, location.gitdir, state)
        if not flags.cached:
            for path in selected:
                absolute = posixpath.join(location.worktree, path)
                await remove_file(dispatch, absolute)
                await remove_empty_parents(dispatch, absolute,
                                           location.worktree)
    except GitError as exc:
        return fatal(exc)
    if flags.quiet:
        return None, IOResult()
    lines = "".join(f"rm '{path}'\n" for path in selected)
    return yield_bytes(lines.encode()), IOResult()
