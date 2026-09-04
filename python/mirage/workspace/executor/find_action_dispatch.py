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

import shlex

from mirage.commands.builtin.find_parse import (EXEC_PLACEHOLDER, ExecAction,
                                                FindExpr, RowAction,
                                                parse_find_expression)
from mirage.commands.config import ExecContext
from mirage.context import (get_current_session, reset_op_policies,
                            suspend_op_policies)
from mirage.io.stream import materialize
from mirage.io.types import ByteSource
from mirage.ops.types import ChildMounts, NamespaceView, StatPath
from mirage.policy import pre_ops_gate
from mirage.types import PathSpec
from mirage.utils.path import resolve_path
from mirage.workspace.mount import MountRegistry
from mirage.workspace.types import ExecuteLine


def _row_scope(path: str, cwd: str) -> PathSpec:
    """The scope a printed row names: rows are respelled as the operand
    was typed, so a relative one resolves against the cwd.

    Args:
        path (str): the row as find printed it.
        cwd (str): the session's working directory.
    """
    virtual = resolve_path(path, cwd)
    return PathSpec(
        virtual=virtual,
        directory=virtual[:virtual.rfind("/") + 1] or "/",
        resource_path="",
        resolved=True,
    )


def exec_line(action: ExecAction, paths: list[str]) -> str:
    """The shell line one ``-exec`` run becomes.

    GNU execs the words directly, so every match must reach the command
    as exactly one argv word: the line is built with ``shlex.join``, and
    a plain join would be re-parsed by the shell. A per-match run
    substitutes every ``{}`` inside every word (``x{}y`` is
    ``xd/a.txty``); a batched run replaces its one bare ``{}`` with the
    matches, one word each.

    Args:
        action (ExecAction): the action.
        paths (list[str]): the match, or every match for a batched run.
    """
    words: list[str] = []
    for word in action.argv:
        if action.batch and word == EXEC_PLACEHOLDER:
            words.extend(paths)
        elif not action.batch:
            words.append(word.replace(EXEC_PLACEHOLDER, paths[0]))
        else:
            words.append(word)
    return shlex.join(words)


async def _run_exec(execute_fn: ExecuteLine, session_id: str,
                    action: ExecAction, paths: list[str], out: list[bytes],
                    errors: list[bytes]) -> bool:
    """Run one ``-exec`` invocation, collecting its streams.

    A command that cannot be found is GNU's ``find: 'cmd': No such file
    or directory`` rather than the shell's ``command not found``, and
    counts as a failed run. Returns whether the run succeeded, which is
    the action's truth value.

    Args:
        execute_fn (ExecuteLine): runs a line in the session.
        session_id (str): the session the line runs under.
        action (ExecAction): the action.
        paths (list[str]): the match, or every match for a batched run.
        out (list[bytes]): where the run's stdout is appended.
        errors (list[bytes]): where its stderr is appended.
    """
    io = await execute_fn(f"( {exec_line(action, paths)} )",
                          session_id=session_id)
    if io.stdout is not None:
        data = await materialize(io.stdout)
        if data:
            out.append(data)
    if io.exit_code == 127:
        errors.append(
            f"find: '{action.argv[0]}': No such file or directory\n".encode())
        return False
    if io.stderr is not None:
        err = await materialize(io.stderr)
        if err:
            errors.append(err)
    return io.exit_code == 0


async def _delete(path: str, registry: MountRegistry, cwd: str,
                  errors: list[bytes]) -> bool:
    """Delete one accepted row; returns whether it succeeded.

    Args:
        path (str): the row as find printed it.
        registry (MountRegistry): used to route the removal.
        cwd (str): the session's working directory.
        errors (list[bytes]): where a failure's line is appended.
    """
    ps = _row_scope(path, cwd)
    mount = registry.try_mount_for(ps.virtual)
    if mount is None:
        errors.append(f"find: cannot delete '{path}': no mount\n".encode())
        return False
    try:
        # -delete is find's own action, not an `rm` line, so no command
        # rule sees it; it is a removal all the same, so it clears the op
        # door a path rule guards (the same gate `ws.fs`, FUSE and a
        # redirect clear), by the session the line runs under, and a
        # refusal reports in find's voice. The delegated rm's own slots
        # are suspended for the call, so the deletion admits exactly
        # once. -d so directories emptied by the deepest-first pass are
        # removable, matching GNU -delete's rmdir behavior.
        sess = get_current_session()
        await pre_ops_gate(registry.policies, "unlink", ps, True, mount.prefix,
                           sess.session_id if sess is not None else "")
        token = suspend_op_policies()
        try:
            _, rm_io = await mount.execute_cmd("rm", [ps], [], {"d": True},
                                               ExecContext(cwd=cwd))
        finally:
            reset_op_policies(token)
    except (FileNotFoundError, NotADirectoryError, PermissionError,
            ValueError) as exc:
        # GNU words it with the errno text; a policy refusal carries its
        # reason there.
        why = (exc.strerror or str(exc)) if isinstance(exc,
                                                       OSError) else str(exc)
        errors.append(f"find: cannot delete '{path}': {why}\n".encode())
        return False
    if rm_io.exit_code != 0:
        err = await materialize(rm_io.stderr) if rm_io.stderr else b""
        errors.append(err or f"find: cannot delete '{path}'\n".encode())
        return False
    return True


async def _ls_row(path: str, registry: MountRegistry, cwd: str,
                  child_mounts: ChildMounts | None, stat_path: StatPath | None,
                  errors: list[bytes]) -> bytes | None:
    ps = _row_scope(path, cwd)
    mount = registry.try_mount_for(ps.virtual)
    if mount is None:
        errors.append(f"find: cannot ls '{path}': no mount\n".encode())
        return None
    try:
        ls_out, _ = await mount.execute_cmd(
            "ls", [ps], [], {
                "args_l": True,
                "d": True
            },
            ExecContext(cwd=cwd,
                        ns=NamespaceView(child_mounts=child_mounts),
                        stat_path=stat_path))
    except (FileNotFoundError, NotADirectoryError, PermissionError,
            ValueError) as exc:
        errors.append(f"find: cannot ls '{path}': {exc}\n".encode())
        return None
    if ls_out is None:
        return None
    line = (await materialize(ls_out)).decode("utf-8",
                                              errors="replace").rstrip("\n")
    return (line + "\n").encode() if line else None


def _has_actions(expr: FindExpr) -> bool:
    return any(not (isinstance(a, RowAction) and a.kind == "print")
               for a in expr.actions)


async def _apply_find_actions(
    stdout: ByteSource | None,
    texts: list[str],
    registry: MountRegistry,
    cwd: str,
    *,
    execute_fn: ExecuteLine | None = None,
    session_id: str = "",
    child_mounts: ChildMounts | None = None,
    stat_path: StatPath | None = None,
) -> tuple[ByteSource | None, bytes, int]:
    """Apply find's actions (-exec / -delete / -print0 / -ls) to its rows.

    Per-resource find handlers only emit matched paths. This dispatcher
    layer re-reads the actions off the expression and applies them per
    match, in the order they were written, the way GNU's implicit ``-a``
    chain runs: each per-match ``-exec`` runs in turn and the first that
    fails ends the chain for that match, so a later ``-print`` (or
    ``-ls``, ``-print0``, ``-delete``) sees only the matches every
    earlier ``-exec`` accepted (``-exec grep -q x {} ";" -print``), and
    ``-exec echo {} ";" -print -exec echo again {} ";"`` alternates the
    three per match. A batched ``-exec ... {} +`` collects the match at
    its position and runs once after the walk; a failing batch is
    find's exit 1, as is a row it could not delete or list; a failing
    per-match run is not, and neither is a command that cannot be
    found, which GNU reports per match and carries on from with exit 0.
    An action other than ``-print`` suppresses the implicit print, and
    ``-delete`` is applied after the walk, deepest first, to the rows
    that reached it.

    Args:
        stdout (ByteSource | None): newline-joined match list from find.
        texts (list[str]): the expression tokens, already validated.
        registry (MountRegistry): used to route per-match dispatch.
        cwd (str): cwd forwarded to per-match sub-dispatch.
        execute_fn (ExecuteLine | None): runs an ``-exec`` line in the
            session; None outside a workspace, where ``-exec`` is
            refused.
        session_id (str): the session the ``-exec`` lines run under.
        child_mounts (ChildMounts | None): namespace child fact, threaded
            into the -ls sub-dispatch so a namespace-only row renders.
        stat_path (StatPath | None): dispatcher stat, threaded with it.

    Returns:
        The rows to print, the stderr to append, and the exit status the
        actions impose (0 when they impose none, even with stderr).
    """
    expr = parse_find_expression(list(texts))
    if not _has_actions(expr) or stdout is None:
        return stdout, b"", 0
    if expr.execs and execute_fn is None:
        return None, b"find: -exec: no shell to run the command\n", 1
    text = (await materialize(stdout)).decode("utf-8", errors="replace")
    matches = [p for p in text.split("\n") if p]
    errors: list[bytes] = []
    out: list[bytes] = []
    batches: dict[int, list[str]] = {}
    to_delete: list[str] = []
    exit_code = 0
    for path in matches:
        for position, action in enumerate(expr.actions):
            if isinstance(action, ExecAction):
                if action.batch:
                    batches.setdefault(position, []).append(path)
                    continue
                assert execute_fn is not None
                if not await _run_exec(execute_fn, session_id, action, [path],
                                       out, errors):
                    break
            elif action.kind == "ls":
                before = len(errors)
                row = await _ls_row(path, registry, cwd, child_mounts,
                                    stat_path, errors)
                if row is not None:
                    out.append(row)
                elif len(errors) > before:
                    exit_code = 1
            elif action.kind == "delete":
                to_delete.append(path)
            else:
                out.append(
                    path.encode("utf-8") +
                    (b"\x00" if action.kind == "print0" else b"\n"))
    for position, action in enumerate(expr.actions):
        paths = batches.get(position)
        if not isinstance(action, ExecAction) or not paths:
            continue
        assert execute_fn is not None
        if not await _run_exec(execute_fn, session_id, action, paths, out,
                               errors):
            exit_code = 1
    if to_delete:
        # Deepest-first so children are removed before parents. Skip
        # structural rows: mount points, and the namespace-only ancestors
        # above a nested mount, are not unlinkable entries; refusing
        # matches Unix semantics. Ancestors use the raw mount table like
        # is_mount_root: an ungranted mount still pins its ancestors in
        # the namespace.
        deletable = [
            p for p in to_delete
            if not registry.is_mount_root(resolve_path(p, cwd))
            and not registry.descendant_mounts(resolve_path(p, cwd))
        ]
        for path in sorted(deletable, key=lambda p: p.count("/"),
                           reverse=True):
            if not await _delete(path, registry, cwd, errors):
                exit_code = 1
    body = b"".join(out)
    return (body if body else None), b"".join(errors), exit_code
