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

import re

from mirage.io import IOResult
from mirage.io.types import ByteSource
from mirage.types import FileType, PathSpec
from mirage.workspace.types import ExecutionNode

_CROSS_COMMANDS = frozenset({"cp", "mv", "diff", "cmp"})
_MULTI_READ_COMMANDS = frozenset({"cat", "head", "tail", "wc", "grep", "rg"})


def is_cross_mount(cmd_name: str, scopes: list[PathSpec], registry) -> bool:
    allowed = _CROSS_COMMANDS | _MULTI_READ_COMMANDS
    if cmd_name not in allowed or len(scopes) < 2:
        return False
    mounts = set()
    for s in scopes:
        try:
            mounts.add(registry.mount_for(s.original).prefix)
        except ValueError:
            pass
    return len(mounts) > 1


async def handle_cross_mount(
    cmd_name: str,
    scopes: list[PathSpec],
    text_args: list[str],
    flag_kwargs: dict,
    dispatch,
    cmd_str: str,
) -> tuple[ByteSource | None, IOResult, ExecutionNode]:
    """Execute a supported command whose path operands span mounts.

    Copy and move follow POSIX operand semantics: every path except the final
    path is a source, and the final path is the destination. An existing
    destination directory maps each source to ``destination/basename``;
    multiple sources require that directory form. Flat-file sources are read
    before mutation so a read failure does not partially modify targets;
    directory sources (``cp -r``, directory ``mv``) walk the tree, create
    destination directories, and copy per file.

    Examples:
        ``cp /ram/a.txt /disk/a.txt`` produces scopes
        ``[/ram/a.txt, /disk/a.txt]``.
        ``cp -n /ram/a.txt /disk/dir`` additionally receives
        ``flag_kwargs={"n": True}``.
        ``mv /ram/a.txt /s3/b.txt /disk/dir`` treats the first two scopes as
        sources and the final scope as the destination directory.

    Args:
        cmd_name (str): Command name, such as ``cp``, ``mv``, or ``cat``.
        scopes (list[PathSpec]): Path operands in command-line order.
        text_args (list[str]): Original non-path command arguments.
        flag_kwargs (dict): Flags parsed from the shared command spec.
        dispatch (Callable): Workspace operation dispatcher.
        cmd_str (str): Original command text for the execution record.

    Returns:
        tuple[ByteSource | None, IOResult, ExecutionNode]: Command output,
        I/O metadata, and execution record.
    """
    try:
        if cmd_name == "cp":
            return await _cross_cp(scopes, flag_kwargs, dispatch, cmd_str)
        if cmd_name == "mv":
            return await _cross_mv(scopes, flag_kwargs, dispatch, cmd_str)
        if cmd_name == "diff":
            return await _cross_diff(scopes, dispatch, cmd_str)
        if cmd_name == "cmp":
            return await _cross_cmp(scopes, dispatch, cmd_str)
        if cmd_name in _MULTI_READ_COMMANDS:
            return await _cross_multi_read(cmd_name, scopes, text_args,
                                           dispatch, cmd_str)
    except (FileNotFoundError, NotADirectoryError, PermissionError) as exc:
        err = f"{cmd_name}: {exc}\n".encode()
        return None, IOResult(exit_code=1,
                              stderr=err), ExecutionNode(command=cmd_str,
                                                         exit_code=1,
                                                         stderr=err)

    err = f"{cmd_name}: cross-mount not supported\n".encode()
    return None, IOResult(exit_code=1,
                          stderr=err), ExecutionNode(command=cmd_str,
                                                     exit_code=1)


def _child_path(parent: PathSpec, source: PathSpec) -> PathSpec:
    name = source.original.rstrip("/").rsplit("/", 1)[-1]
    return PathSpec.from_str_path(parent.child(name), parent.prefix)


async def _cross_targets(scopes, dispatch):
    # Resolve the complete source-to-target mapping before any mutation.
    *sources, dst = scopes
    try:
        dst_stat, _ = await dispatch("stat", dst)
        dst_is_dir = dst_stat.type == FileType.DIRECTORY
    except FileNotFoundError:
        dst_is_dir = False
    if len(sources) > 1 and not dst_is_dir:
        raise NotADirectoryError(f"target '{dst.original}' is not a directory")
    targets = ([_child_path(dst, src)
                for src in sources] if dst_is_dir else [dst])
    return sources, targets


async def _read_cross_sources(sources, dispatch):
    # Pre-read all sources so a later read failure cannot leave partial writes.
    source_data = []
    for src in sources:
        data, _ = await dispatch("read", src)
        source_data.append(data)
    return source_data


async def _cross_target_exists(target: PathSpec, dispatch) -> bool:
    try:
        await dispatch("stat", target)
    except FileNotFoundError:
        return False
    return True


def _cross_result(cmd_str, errors):
    if errors:
        err = ("\n".join(errors) + "\n").encode()
        return None, IOResult(exit_code=1,
                              stderr=err), ExecutionNode(command=cmd_str,
                                                         exit_code=1,
                                                         stderr=err)
    return None, IOResult(), ExecutionNode(command=cmd_str, exit_code=0)


async def _partition_sources(cmd, sources, targets, recursive, dispatch):
    # Split sources into files and directories. cp without -r omits
    # directories (coreutils prints an error and still copies the files);
    # mv always moves directories.
    file_srcs: list[PathSpec] = []
    file_targets: list[PathSpec] = []
    dir_pairs: list[tuple[PathSpec, PathSpec]] = []
    errors: list[str] = []
    for src, target in zip(sources, targets):
        src_stat, _ = await dispatch("stat", src)
        if src_stat.type == FileType.DIRECTORY:
            if cmd == "cp" and not recursive:
                errors.append("cp: -r not specified; omitting directory "
                              f"'{src.original}'")
                continue
            dir_pairs.append((src, target))
        else:
            file_srcs.append(src)
            file_targets.append(target)
    return file_srcs, file_targets, dir_pairs, errors


async def _copy_tree(src_dir, dst_dir, dispatch, no_clobber):
    # Recreate the source subtree under the destination. Directories are
    # created top-down so each parent exists before its children; an
    # already-present destination directory is merged into (coreutils cp
    # -r), so a FileExistsError from mkdir is expected, not a failure.
    try:
        await dispatch("mkdir", dst_dir)
    except FileExistsError:
        pass
    children, _ = await dispatch("readdir", src_dir)
    for child in children:
        name = child.rstrip("/").rsplit("/", 1)[-1]
        child_src = PathSpec.from_str_path(child, src_dir.prefix)
        child_dst = PathSpec.from_str_path(dst_dir.child(name), dst_dir.prefix)
        child_stat, _ = await dispatch("stat", child_src)
        if child_stat.type == FileType.DIRECTORY:
            await _copy_tree(child_src, child_dst, dispatch, no_clobber)
            continue
        if no_clobber and await _cross_target_exists(child_dst, dispatch):
            continue
        data, _ = await dispatch("read", child_src)
        await dispatch("write", child_dst, data=data)


async def _remove_tree(src_dir, dispatch):
    # Delete a source directory after a cross-mount move. Walks bottom-up
    # (children before the dir) using ops every backend exposes, since
    # rm_recursive is not registered on all of them.
    children, _ = await dispatch("readdir", src_dir)
    for child in children:
        child_src = PathSpec.from_str_path(child, src_dir.prefix)
        child_stat, _ = await dispatch("stat", child_src)
        if child_stat.type == FileType.DIRECTORY:
            await _remove_tree(child_src, dispatch)
        else:
            await dispatch("unlink", child_src)
    await dispatch("rmdir", src_dir)


async def _cross_cp(scopes, flag_kwargs, dispatch, cmd_str):
    sources, targets = await _cross_targets(scopes, dispatch)
    recursive = bool(
        flag_kwargs.get("r") or flag_kwargs.get("R") or flag_kwargs.get("a"))
    no_clobber = flag_kwargs.get("n") is True
    file_srcs, file_targets, dir_pairs, errors = await _partition_sources(
        "cp", sources, targets, recursive, dispatch)
    # Pre-read flat-file sources before writing so a read failure cannot
    # leave partial writes; directory trees stream per file during the walk.
    source_data = await _read_cross_sources(file_srcs, dispatch)
    for target, data in zip(file_targets, source_data):
        # Check immediately before writing: earlier sources may share this
        # basename and create the target during the same command.
        if no_clobber and await _cross_target_exists(target, dispatch):
            continue
        await dispatch("write", target, data=data)
    for src, target in dir_pairs:
        await _copy_tree(src, target, dispatch, no_clobber)
    return _cross_result(cmd_str, errors)


async def _cross_mv(scopes, flag_kwargs, dispatch, cmd_str):
    sources, targets = await _cross_targets(scopes, dispatch)
    no_clobber = flag_kwargs.get("n") is True
    file_srcs, file_targets, dir_pairs, errors = await _partition_sources(
        "mv", sources, targets, True, dispatch)
    source_data = await _read_cross_sources(file_srcs, dispatch)
    moved_files: list[PathSpec] = []
    for src, target, data in zip(file_srcs, file_targets, source_data):
        # A skipped no-clobber target must also preserve its source.
        if no_clobber and await _cross_target_exists(target, dispatch):
            continue
        await dispatch("write", target, data=data)
        moved_files.append(src)
    moved_dirs: list[PathSpec] = []
    for src, target in dir_pairs:
        if no_clobber and await _cross_target_exists(target, dispatch):
            continue
        await _copy_tree(src, target, dispatch, no_clobber)
        moved_dirs.append(src)
    # Delete only sources whose destination copy completed.
    for src in moved_files:
        await dispatch("unlink", src)
    for src in moved_dirs:
        await _remove_tree(src, dispatch)
    return _cross_result(cmd_str, errors)


async def _cross_diff(scopes, dispatch, cmd_str):
    import difflib

    data_a, _ = await dispatch("read", scopes[0])
    data_b, _ = await dispatch("read", scopes[1])
    lines_a = data_a.decode(errors="replace").splitlines(keepends=True)
    lines_b = data_b.decode(errors="replace").splitlines(keepends=True)
    diff = list(
        difflib.unified_diff(lines_a,
                             lines_b,
                             fromfile=scopes[0].original,
                             tofile=scopes[1].original))
    if diff:
        out = "".join(diff).encode()
        return out, IOResult(exit_code=1), ExecutionNode(command=cmd_str,
                                                         exit_code=1)
    return b"", IOResult(), ExecutionNode(command=cmd_str, exit_code=0)


async def _cross_cmp(scopes, dispatch, cmd_str):
    data_a, _ = await dispatch("read", scopes[0])
    data_b, _ = await dispatch("read", scopes[1])
    if data_a == data_b:
        return b"", IOResult(), ExecutionNode(command=cmd_str, exit_code=0)
    for i, (a, b) in enumerate(zip(data_a, data_b)):
        if a != b:
            msg = (f"{scopes[0].original} {scopes[1].original} "
                   f"differ: byte {i + 1}\n")
            return msg.encode(), IOResult(exit_code=1), ExecutionNode(
                command=cmd_str, exit_code=1)
    shorter = scopes[0].original if len(data_a) < len(
        data_b) else scopes[1].original
    msg = f"cmp: EOF on {shorter}\n"
    return msg.encode(), IOResult(exit_code=1), ExecutionNode(command=cmd_str,
                                                              exit_code=1)


async def _cross_multi_read(cmd_name, scopes, text_args, dispatch, cmd_str):
    """Read each file from its own mount, apply command logic per-file."""
    file_data: list[tuple[str, bytes]] = []
    reads: dict[str, bytes] = {}
    cache: list[str] = []
    for scope in scopes:
        data, _ = await dispatch("read", scope)
        if isinstance(data, bytes):
            file_data.append((scope.original, data))
            reads[scope.original] = data
            cache.append(scope.original)

    io = IOResult(reads=reads, cache=cache)

    if cmd_name == "cat":
        combined = b"".join(d for _, d in file_data)
        return combined, io, ExecutionNode(command=cmd_str, exit_code=0)

    if cmd_name in ("head", "tail"):
        n = 10
        for i, arg in enumerate(text_args):
            if arg == "-n" and i + 1 < len(text_args):
                try:
                    n = int(text_args[i + 1])
                except ValueError:
                    err = (f"{cmd_name}: invalid number: "
                           f"{text_args[i + 1]!r}\n").encode()
                    return None, IOResult(
                        exit_code=1,
                        stderr=err,
                    ), ExecutionNode(
                        command=cmd_str,
                        exit_code=1,
                        stderr=err,
                    )
        parts: list[str] = []
        multi = len(file_data) > 1
        for name, data in file_data:
            lines = data.decode(errors="replace").splitlines()
            if multi:
                parts.append(f"==> {name} <==")
            if cmd_name == "head":
                parts.extend(lines[:n])
            else:
                parts.extend(lines[-n:])
        return "\n".join(parts).encode() + b"\n", io, ExecutionNode(
            command=cmd_str, exit_code=0)

    if cmd_name in ("grep", "rg"):
        pattern = text_args[0] if text_args else ""
        flags = 0
        if "-i" in text_args:
            flags = re.IGNORECASE
        compiled = re.compile(pattern, flags)
        results: list[str] = []
        for name, data in file_data:
            for line in data.decode(errors="replace").splitlines():
                if compiled.search(line):
                    results.append(f"{name}:{line}")
        if not results:
            io.exit_code = 1
            return b"", io, ExecutionNode(command=cmd_str, exit_code=1)
        return "\n".join(results).encode() + b"\n", io, ExecutionNode(
            command=cmd_str, exit_code=0)

    if cmd_name == "wc":
        parts = []
        for name, data in file_data:
            text = data.decode(errors="replace")
            lines = text.count("\n")
            words = len(text.split())
            chars = len(data)
            if "-l" in text_args:
                parts.append(f"{lines} {name}")
            elif "-w" in text_args:
                parts.append(f"{words} {name}")
            elif "-c" in text_args:
                parts.append(f"{chars} {name}")
            else:
                parts.append(f"{lines} {words} {chars} {name}")
        return "\n".join(parts).encode() + b"\n", io, ExecutionNode(
            command=cmd_str, exit_code=0)

    combined = b"".join(d for _, d in file_data)
    return combined, io, ExecutionNode(command=cmd_str, exit_code=0)
