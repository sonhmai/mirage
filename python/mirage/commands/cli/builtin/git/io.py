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

import logging
import posixpath

from mirage.commands.cli.builtin.git.constants import PERMISSION_BITS, SYMLINK
from mirage.ops.types import LinkView, StatPath
from mirage.runtime.types import DispatchFn
from mirage.types import LINK_TARGET_KEY, FileStat, FileType, PathSpec
from mirage.utils.errors import MISS_ERRORS

logger = logging.getLogger(__name__)


async def read_file(dispatch: DispatchFn, path: str) -> bytes:
    """Read one virtual path through the workspace dispatcher.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
    """
    data, _ = await dispatch("read", PathSpec.from_str_path(path))
    return data if isinstance(data, bytes) else bytes(data)


async def entry_bytes(dispatch: DispatchFn, path: str,
                      info: FileStat) -> bytes:
    """The bytes git stores for one working-tree entry.

    A symlink's blob is its target string, not what the target holds, so
    reading through the link would stage a second copy of the target
    under mode 100644 and then report the entry modified forever after
    (the staged blob and the bytes behind the link never match). The
    target is namespace state, which is why it arrives on the stat
    rather than from a read.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
        info (FileStat): what the walk saw at that path, lstat-style.
    """
    if info.type is FileType.SYMLINK:
        target = info.extra.get(LINK_TARGET_KEY)
        if isinstance(target, str):
            return target.encode()
    return await read_file(dispatch, path)


async def restore_entry(dispatch: DispatchFn,
                        path: str,
                        mode: int,
                        blob: bytes,
                        links: LinkView | None = None) -> None:
    """Materialize one tree entry into the working tree.

    A 120000 entry is a symlink whose blob is the target string, so it
    is restored through the namespace rather than written as content:
    writing the blob would leave a regular file spelling the target.

    Whatever is already there goes first, whichever kind it is, because
    git replaces a tree entry rather than merging with it. Two of the
    four combinations are the ones that corrupt state: writing a regular
    blob at a path the namespace holds a link for follows the link and
    lands the content in the file it points at, damaging a path no
    branch touched while the link stays; and linking over a regular file
    leaves that file behind the link, ready to reappear when the link
    goes. The fourth, a link over a link, is the retarget a checkout
    does when a branch moves where a link points: symlink(2) does not
    overwrite, so the old name is removed rather than replaced in place.
    The check is a namespace lookup, so the ordinary file-for-file case
    costs nothing.

    The permission bits are part of the entry, not decoration on it.
    git records exactly one of them, the owner's execute bit, and puts
    it back in both directions: ``chmod -x`` on a ``100755`` path is a
    modification ``restore`` undoes, and ``chmod +x`` on a ``100644``
    one is a modification it undoes the other way. Writing the bytes
    alone left the bit as the working tree had it, so the file came back
    unrunnable and ``status`` went on calling it modified for ever. The
    write is unconditional rather than probed: a stat to decide costs
    the same op as the setattr it would save, and the backends git
    actually runs on apply it natively, so nothing reaches the overlay.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path to materialize at.
        mode (int): the tree entry's mode.
        blob (bytes): the entry's blob content.
        links (LinkView | None): the name plane's link facts, None when
            no namespace is wired.
    """
    linked = links is not None and links.stat_at(path) is not None
    if mode == SYMLINK:
        await remove_file(dispatch, path)
        await dispatch("symlink",
                       PathSpec.from_str_path(path),
                       target=blob.decode("utf-8", errors="replace"))
        return
    if linked:
        await remove_file(dispatch, path)
    await write_file(dispatch, path, blob)
    await dispatch("setattr",
                   PathSpec.from_str_path(path),
                   mode=mode & PERMISSION_BITS)


async def read_range(dispatch: DispatchFn, path: str, offset: int,
                     size: int) -> bytes:
    """Read a byte range of one virtual path.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
        offset (int): first byte to read.
        size (int): how many bytes to read.
    """
    data, _ = await dispatch("read",
                             PathSpec.from_str_path(path),
                             offset=offset,
                             size=size)
    return data if isinstance(data, bytes) else bytes(data)


async def file_size(dispatch: DispatchFn, path: str) -> int | None:
    """A path's byte length, or None when the backend does not know it.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
    """
    stat, _ = await dispatch("stat", PathSpec.from_str_path(path))
    return getattr(stat, "size", None)


async def read_optional(dispatch: DispatchFn, path: str) -> bytes | None:
    """Read a path that a repository may legitimately not have.

    ``packed-refs`` and ``HEAD``-adjacent files are absent in perfectly
    valid repositories, so a miss is an answer rather than an error.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
    """
    try:
        return await read_file(dispatch, path)
    except MISS_ERRORS:
        return None


async def read_names(dispatch: DispatchFn, path: str) -> list[str]:
    """List a directory, empty when it does not exist.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path of the directory.
    """
    try:
        entries, _ = await dispatch("readdir", PathSpec.from_str_path(path))
    except MISS_ERRORS:
        return []
    return list(entries or [])


async def ensure_dir(dispatch: DispatchFn, path: str) -> None:
    """Create a directory and every missing directory above it.

    Written out rather than delegated to ``mkdir -p`` because the
    parents flag is a per-backend capability: the ops factory only wires
    ``parents=True`` for backends that declare it, so a plain ``mkdir``
    of ``objects/ab`` fails on the rest.

    Existence is probed with a point stat, which on a prefix store misses
    a directory that has no object of its own. That false negative is
    harmless here and the reason this does not need the two-channel
    stat: on such a store a directory is the set of keys under it, so
    creating one again costs a no-op rather than an error.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path of the directory.
    """
    missing: list[str] = []
    current = path.rstrip("/")
    while current and current != "/":
        try:
            await dispatch("stat", PathSpec.from_str_path(current))
            break
        except MISS_ERRORS:
            missing.append(current)
            current = posixpath.dirname(current)
    for target in reversed(missing):
        await dispatch("mkdir", PathSpec.from_str_path(target))


async def exists(dispatch: DispatchFn, path: str) -> bool:
    """Whether a point lookup finds anything at a path.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
    """
    try:
        await dispatch("stat", PathSpec.from_str_path(path))
    except MISS_ERRORS:
        return False
    return True


async def write_file(dispatch: DispatchFn, path: str, data: bytes) -> None:
    """Write one virtual path, creating the directories above it.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
        data (bytes): the whole contents.
    """
    await ensure_dir(dispatch, posixpath.dirname(path))
    await dispatch("write", PathSpec.from_str_path(path), data=data)


async def write_once(dispatch: DispatchFn, path: str, data: bytes) -> None:
    """Write a path only if nothing is there yet.

    For content-addressed files, which is every object in the database:
    a path that exists already holds exactly these bytes, because its
    name is a hash of them. Skipping the write is therefore not an
    optimisation but a requirement, since git writes loose objects
    read-only (0444) and rewriting one fails with EACCES. Re-staging an
    unchanged file hits that on the first try.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
        data (bytes): the whole contents.
    """
    if await exists(dispatch, path):
        return
    await write_file(dispatch, path, data)


async def blocking_ancestor(stat_path: StatPath, worktree: str, name: str,
                            links: LinkView | None) -> str | None:
    """The nearest component above an entry that is not a directory.

    An entry's path is only a way through the working tree while every
    component above it is a directory. Anything else standing on one --
    a symlink, a regular file, tracked or not -- is not a way through,
    and the two directions take it differently. Writing the entry
    *replaces* it with the directory the entry needs, leaving whatever
    a link pointed at exactly as it was; removing the entry does
    nothing at all, because the path never led there. That is git's
    ``create_directories`` and ``check_leading_path``, and both halves
    were probed against git 2.50.1.

    The namespace is asked before the data plane, and the order is the
    whole point: ``stat_path`` dereferences, so a link to a directory
    stats as a directory and the walk would carry on straight through
    it. Only the name plane can say that the component is a link.

    An exact-path lookup cannot see any of this, since what is in the
    way sits above the name being looked up rather than on it.

    Args:
        stat_path (StatPath): the data plane's stat, which dereferences.
        worktree (str): absolute virtual path of the working tree root.
        name (str): the entry, repository-relative.
        links (LinkView | None): the name plane's link facts, None when
            no namespace is wired.

    Returns:
        str | None: absolute virtual path of the nearest such component,
        None when every component above the entry is a directory.
    """
    current = worktree
    for part in name.split("/")[:-1]:
        current = posixpath.join(current, part)
        if links is not None and links.stat_at(current) is not None:
            return current
        info = await stat_path(current)
        if info is not None and info.type is not FileType.DIRECTORY:
            return current
    return None


async def remove_file(dispatch: DispatchFn, path: str) -> None:
    """Delete one virtual path, tolerating one that is already gone.

    A miss is an answer rather than an error for every caller here:
    unstaging a path deletes whatever ref or lock may or may not exist,
    and a checkout removes files the other branch does not have.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path.
    """
    try:
        await dispatch("unlink", PathSpec.from_str_path(path))
    except MISS_ERRORS as exc:
        logger.debug("nothing to remove at %s: %s", path, exc)


async def rename_path(dispatch: DispatchFn, source: str, target: str) -> None:
    """Move one virtual path, file or directory, to another name.

    The mount's own rename, so a directory moves with everything under
    it, tracked or not, which is what ``git mv`` does with a directory.
    The destination's directory is not created: git's rename fails when
    it is missing, and the caller words that failure.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        source (str): absolute virtual path to move.
        target (str): absolute virtual path to move it to.
    """
    await dispatch("rename",
                   PathSpec.from_str_path(source),
                   dst=PathSpec.from_str_path(target))


async def remove_tree(dispatch: DispatchFn, path: str,
                      links: LinkView | None) -> None:
    """Delete a path and everything under it, tracked or not.

    git replaces a tree entry rather than merging with it, so a
    directory standing where the source keeps a file goes entirely.
    That is one of the few places git removes a file it never tracked:
    an untracked child keeps the directory alive after the tracked ones
    are gone, and restoring the file over it would otherwise fail with
    the index already changed.

    A file and an absent path both walk out through the same two steps,
    since ``readdir`` reads a non-directory as nothing there and
    ``rmdir`` refuses it.

    A child that is a symlink is unlinked, never descended into. The
    name plane has to say so, because ``readdir`` dereferences: a link
    to a directory lists that directory's contents, and recursing on
    them deletes a tree outside the one being replaced. ``rm -r`` does
    not follow a link either, so a branch recording a file where the
    working tree has a directory takes the link away with the directory
    and leaves whatever it pointed at exactly as it was. Pinned against
    git 2.50.1.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path to clear.
        links (LinkView | None): the name plane's link facts, None when
            no namespace is wired.
    """
    for entry in await read_names(dispatch, path):
        # A listing answers in whole paths, so the child is rebuilt from
        # the basename the way every other walk here does.
        name = entry.rstrip("/").rsplit("/", 1)[-1]
        if not name:
            continue
        child = posixpath.join(path, name)
        if links is not None and links.stat_at(child) is not None:
            await remove_file(dispatch, child)
            continue
        await remove_tree(dispatch, child, links)
    try:
        await dispatch("rmdir", PathSpec.from_str_path(path))
    except MISS_ERRORS as exc:
        # Not a directory, or already gone: the path is whatever one file
        # it is, and remove_file tolerates an absent one. A directory the
        # walk above was supposed to empty raises OSError(ENOTEMPTY),
        # which is not a miss and stays raised.
        logger.debug("no directory to remove at %s: %s", path, exc)
        await remove_file(dispatch, path)


async def remove_empty_parents(dispatch: DispatchFn, path: str,
                               stop: str) -> None:
    """Drop the directories a deletion left empty, up to a root.

    git removes a directory the moment its last tracked file is deleted
    or restored away, so ``rm -r docs`` leaves no ``docs/`` behind. The
    walk stops at the first directory that still holds something and
    never touches ``stop`` itself.

    Args:
        dispatch (DispatchFn): workspace op dispatcher.
        path (str): absolute virtual path of the file that was removed.
        stop (str): absolute virtual path of the working tree root.
    """
    root = stop.rstrip("/") or "/"
    current = posixpath.dirname(path)
    while current != root and current.startswith(root):
        if await read_names(dispatch, current):
            return
        try:
            await dispatch("rmdir", PathSpec.from_str_path(current))
        except MISS_ERRORS as exc:
            logger.debug("no directory to remove at %s: %s", current, exc)
            return
        current = posixpath.dirname(current)
