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
from dulwich.objects import ObjectID
from dulwich.objectspec import parse_tree
from dulwich.repo import BaseRepo

from mirage.commands.cli.builtin.git.changes import head_entries
from mirage.commands.cli.builtin.git.checkout import (Tree, contents,
                                                      flat_tree, tree_of)
from mirage.commands.cli.builtin.git.errors import GitError  # yapf: disable
from mirage.commands.cli.builtin.git.errors import (  # yapf: disable
    NoRestorePathsError, NoWorkspaceError, UnknownPathspecError,
    UnknownSwitchError, UnresolvableSourceError)
from mirage.commands.cli.builtin.git.index import read_index, write_index
from mirage.commands.cli.builtin.git.io import (remove_empty_parents,
                                                remove_file, restore_entry)
from mirage.commands.cli.builtin.git.pathspec import matched, repo_relative
from mirage.commands.cli.builtin.git.reset import restored
from mirage.commands.cli.builtin.git.revparse import resolve_commit
from mirage.commands.cli.builtin.git.session import opened
from mirage.commands.cli.builtin.git.util import (  # yapf: disable
    check_operands, escaped, fatal, links_of, start_point)
from mirage.commands.cli.types import CLIDoors, CLIInvocation
from mirage.commands.spec.types import FlagView
from mirage.io.types import ByteSource, IOResult


@dataclass(frozen=True, slots=True)
class RestoreFlags:
    """The parsed shape of a ``git restore`` invocation.

    Args:
        staged (bool): ``--staged``, put the index back.
        worktree (bool): ``--worktree``, put the working tree back. The
            default when ``--staged`` is absent, which is git's rule.
        source (str | None): ``--source``, the tree to restore from.
            None means the index for the working tree and HEAD for the
            index.
    """
    staged: bool
    worktree: bool
    source: str | None


def parse_flags(fl: FlagView) -> RestoreFlags:
    """Read the raw restore flag kwargs into a frozen struct.

    Args:
        fl (FlagView): spec-validated view over the raw flag kwargs.
    """
    staged = fl.as_bool("staged")
    return RestoreFlags(staged=staged,
                        worktree=fl.as_bool("worktree") or not staged,
                        source=fl.as_str("source"))


def index_tree(entries: dict[bytes, IndexEntry]) -> Tree:
    """The index read as a tree: every path with its mode and blob id.

    Args:
        entries (dict[bytes, IndexEntry]): the index.
    """
    return {path: (entry.mode, entry.sha) for path, entry in entries.items()}


def decoded(paths: set[bytes] | dict[bytes, tuple[int, bytes]]) -> set[str]:
    """Repository-relative paths as text.

    Args:
        paths (set[bytes] | dict): index or tree keys.
    """
    return {path.decode("utf-8", errors="replace") for path in paths}


def source_tree(repo: BaseRepo, revision: str) -> Tree:
    """Every path a ``--source`` names, commit-ish or tree-ish.

    git takes any tree-ish here, so a raw tree id
    (``--source=$(git rev-parse HEAD^{tree})``) is as good as a branch.
    A commit-ish is tried first because it is what the option is
    normally spelled with and it is the only form carrying ancestry
    suffixes; a revision neither reading resolves is unresolvable.

    Args:
        repo (BaseRepo): the opened repository.
        revision (str): the source as the user spelled it.
    """
    try:
        commit = resolve_commit(repo, revision)
    except GitError:
        # Not a commit-ish. The id is read as a tree before the
        # revision is called unresolvable, never instead of reporting
        # it: a spelling neither reading accepts still refuses here.
        try:
            return flat_tree(repo, parse_tree(repo, revision).id)
        except (AssertionError, KeyError, ValueError) as exc:
            # dulwich asserts rather than raises on a name that is not
            # hex at all, so the refusal has to catch that too or a
            # typo escapes as an unhandled error.
            raise UnresolvableSourceError(revision) from exc
    return tree_of(repo, commit.id)


async def restore(
        inv: CLIInvocation[None]) -> tuple[ByteSource | None, IOResult]:
    """Put paths back to what a source records.

    Two targets and one source, git's own model. ``--staged`` restores
    the index and ``--worktree`` the working tree; the default is the
    working tree alone. The source is the index for the working tree
    and HEAD for the index unless ``--source`` names a tree, in which
    case a selected path the source does not hold is removed from
    whichever target is being restored, since that is what "make it
    match the source" means for it. Pinned against git 2.50.1.

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
        if not texts:
            raise NoRestorePathsError()
        flags = parse_flags(fl)
        repo, location = await opened(fl, doors)
        state = await read_index(dispatch, location.gitdir)
        held = index_tree(state.entries)
        if flags.source is not None:
            source: Tree | None = await asyncio.to_thread(
                source_tree, repo, flags.source)
        elif flags.staged:
            source = await asyncio.to_thread(head_entries, repo) or {}
        else:
            source = None
        tree = held if source is None else source
        names = decoded(held) | decoded(tree)
        start = start_point(fl)
        selected: set[str] = set()
        for operand in texts:
            hits = matched(names, repo_relative(location, start, operand))
            if not hits:
                raise UnknownPathspecError(operand)
            selected |= hits
        present = {name for name in selected if name.encode() in tree}
        absent = selected - present
        if flags.staged:
            for name in present:
                mode, sha = tree[name.encode()]
                state.entries[name.encode()] = restored(ObjectID(sha), mode)
            for name in absent:
                state.entries.pop(name.encode(), None)
            # A restored path is no longer unmerged, and saying so is
            # not optional: write_index lays the conflict stages over
            # the entries, so a stage left behind both keeps the path
            # conflicted and discards the entry just written for it.
            for name in selected:
                state.conflicts.pop(name.encode(), None)
            await write_index(dispatch, location.gitdir, state)
        if flags.worktree:
            blobs = await asyncio.to_thread(
                contents, repo, [tree[name.encode()][1] for name in present])
            # Removals first, because the two sets can name the same
            # place: restoring a directory over a file writes
            # ``slot/child`` where the file ``slot`` still sits, and the
            # other direction writes the file where the directory still
            # sits. Nothing is read back from the working tree, so
            # emptying it first is free.
            for name in sorted(absent):
                path = posixpath.join(location.worktree, name)
                await remove_file(dispatch, path)
                await remove_empty_parents(dispatch, path, location.worktree)
            for name in sorted(present):
                mode, sha = tree[name.encode()]
                await restore_entry(dispatch,
                                    posixpath.join(location.worktree, name),
                                    mode, blobs[sha], links_of(doors))
    except GitError as exc:
        return fatal(exc)
    return None, IOResult()
