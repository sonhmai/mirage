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
from mirage.ops.types import NamespaceView, StatPath
from mirage.policy import pre_ops_gate
from mirage.types import PathSpec
from mirage.utils.path import resolve_path
from mirage.workspace.lookup.lookup import lookup
from mirage.workspace.lookup.types import Consumer
from mirage.workspace.mount import MountRegistry
from mirage.workspace.types import ExecuteLine


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


async def _head_missing(head: str, registry: MountRegistry, cwd: str,
                        stat_path: StatPath | None) -> bool:
    """Whether ``execvp`` would fail to find an ``-exec`` head word.

    A head carrying a slash is a file the loader runs, which no
    builtin, function or CLI can claim, so it is statted where the
    line would read it; any other head is looked up by name across
    the layers dispatch consults.

    Args:
        head (str): the first word of the action.
        registry (MountRegistry): where a name is looked up.
        cwd (str): the session's working directory.
        stat_path (StatPath | None): dispatcher stat, None outside a
            workspace, where the loader answers for itself.
    """
    if "/" in head:
        return (stat_path is not None
                and await stat_path(resolve_path(head, cwd)) is None)
    sess = get_current_session()
    return sess is not None and lookup(head, sess,
                                       registry) is Consumer.UNKNOWN


async def _run_exec(execute_fn: ExecuteLine, session_id: str,
                    registry: MountRegistry, cwd: str,
                    stat_path: StatPath | None, action: ExecAction,
                    paths: list[str], out: list[bytes],
                    errors: list[bytes]) -> bool:
    """Run one ``-exec`` invocation, collecting its streams.

    A command that cannot be found is GNU's ``find: 'cmd': No such file
    or directory`` rather than the shell's ``command not found``, and
    counts as a failed run. That is decided by looking the head word up
    before the line runs (GNU fails in ``execvp``), never from the exit
    status: a program that exists and exits 127 keeps its own stderr and
    is just a failed run. Returns whether the run succeeded, which is
    the action's truth value.

    Args:
        execute_fn (ExecuteLine): runs a line in the session.
        session_id (str): the session the line runs under.
        registry (MountRegistry): where the head word is looked up.
        cwd (str): the session's working directory.
        stat_path (StatPath | None): dispatcher stat for a slash head.
        action (ExecAction): the action.
        paths (list[str]): the match, or every match for a batched run.
        out (list[bytes]): where the run's stdout is appended.
        errors (list[bytes]): where its stderr is appended.
    """
    head = action.argv[0]
    if await _head_missing(head, registry, cwd, stat_path):
        errors.append(f"find: '{head}': No such file or directory\n".encode())
        return False
    io = await execute_fn(f"( {exec_line(action, paths)} )",
                          session_id=session_id)
    if io.stdout is not None:
        data = await materialize(io.stdout)
        if data:
            out.append(data)
    if io.stderr is not None:
        err = await materialize(io.stderr)
        if err:
            errors.append(err)
    return io.exit_code == 0


async def _delete(ps: PathSpec, registry: MountRegistry, cwd: str,
                  errors: list[bytes]) -> bool:
    """Delete one accepted row; returns whether it succeeded.

    Args:
        ps (PathSpec): the selected row, with its display spelling.
        registry (MountRegistry): used to route the removal.
        cwd (str): the session's working directory.
        errors (list[bytes]): where a failure's line is appended.
    """
    path = ps.raw_path or ps.virtual
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
        # once. -d so a directory emptied by the rows before it in -depth
        # order is removable, matching GNU -delete's rmdir behavior.
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
        # rm names the reason last (`rm: cannot remove '/w/d': Directory
        # not empty`), and find says the same thing about the row as it
        # was typed.
        why = err.decode("utf-8", errors="replace").strip().rsplit(": ", 1)[-1]
        errors.append(f"find: cannot delete '{path}'"
                      f"{': ' + why if why else ''}\n".encode())
        return False
    return True


async def _ls_row(ps: PathSpec, registry: MountRegistry, cwd: str,
                  ns: NamespaceView | None, stat_path: StatPath | None,
                  errors: list[bytes]) -> bytes | None:
    path = ps.raw_path or ps.virtual
    mount = registry.try_mount_for(ps.virtual)
    if mount is None:
        errors.append(f"find: cannot ls '{path}': no mount\n".encode())
        return None
    try:
        ls_out, _ = await mount.execute_cmd(
            "ls", [ps], [], {
                "args_l": True,
                "d": True
            }, ExecContext(cwd=cwd, ns=ns, stat_path=stat_path))
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
    """Whether the actions differ from the implicit print.

    One explicit ``-print`` is exactly what the backend already
    rendered; two of them print every row twice, as GNU does.

    Args:
        expr (FindExpr): the parsed expression.
    """
    return len(expr.actions) > 1 or any(
        not (isinstance(a, RowAction) and a.kind == "print")
        for a in expr.actions)


def depth_first_key(path: str) -> tuple[tuple[str, int], ...]:
    """The sort key for GNU's ``-depth`` order over sorted siblings.

    A directory's contents, each sorted, then the directory: the final
    component is flagged so a path sorts after its descendants, whose
    entry at that depth carries the same name unflagged.

    Args:
        path (str): a row as find printed it.
    """
    parts = path.split("/")
    return (*((part, 0) for part in parts[:-1]), (parts[-1], 1))


def _structural(path: PathSpec, registry: MountRegistry) -> bool:
    """Whether a row is a mount point or a namespace-only ancestor of
    one, which are not unlinkable entries. Ancestors use the raw mount
    table like ``is_mount_root``: an ungranted mount still pins its
    ancestors in the namespace.

    Args:
        path (PathSpec): the selected row.
        registry (MountRegistry): the mount table.
    """
    virtual = path.virtual
    return (registry.is_mount_root(virtual)
            or bool(registry.descendant_mounts(virtual)))


async def _apply_find_actions(
    stdout: ByteSource | None,
    matched_paths: list[PathSpec] | None,
    texts: list[str],
    registry: MountRegistry,
    cwd: str,
    *,
    execute_fn: ExecuteLine | None = None,
    session_id: str = "",
    ns: NamespaceView | None = None,
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
    An action other than ``-print`` suppresses the implicit print.
    ``-delete`` runs at its position, so a later ``-exec`` sees the row
    gone, and a row it cannot delete ends the chain with GNU's line and
    find's exit 1. It also turns on ``-depth``, which orders every
    directory after its contents, the only order a tree can be removed
    in; ``-depth`` alone reorders the implicit print the same way.

    Args:
        stdout (ByteSource | None): display output from find.
        matched_paths (list[PathSpec] | None): matches before rendering.
        texts (list[str]): the expression tokens, already validated.
        registry (MountRegistry): used to route per-match dispatch.
        cwd (str): cwd forwarded to per-match sub-dispatch.
        execute_fn (ExecuteLine | None): runs an ``-exec`` line in the
            session; None outside a workspace, where ``-exec`` is
            refused.
        session_id (str): the session the ``-exec`` lines run under.
        ns (NamespaceView | None): the name plane's facts, threaded into
            the -ls sub-dispatch so a namespace-only row (a mount point,
            a symlink) renders the way ``ls -l`` renders it.
        stat_path (StatPath | None): dispatcher stat, threaded with it
            and used to find a slash-carrying ``-exec`` head.

    Returns:
        The rows to print, the stderr to append, and the exit status the
        actions impose (0 when they impose none, even with stderr).
    """
    expr = parse_find_expression(list(texts))
    reorders = expr.depth_first and expr.printf is None
    if stdout is None or not (_has_actions(expr) or reorders):
        return stdout, b"", 0
    if expr.execs and execute_fn is None:
        return None, b"find: -exec: no shell to run the command\n", 1
    if matched_paths is None:
        return None, b"find: actions require structured matches\n", 1
    matches = list(matched_paths)
    if reorders:
        matches.sort(key=lambda p: depth_first_key(p.raw_path or p.virtual))
    # An expression with no action of its own prints, which is the one
    # implicit action -depth reorders.
    actions = expr.actions or [RowAction("print")]
    errors: list[bytes] = []
    out: list[bytes] = []
    batches: dict[int, list[str]] = {}
    exit_code = 0
    for match in matches:
        path = match.raw_path or match.virtual
        for position, action in enumerate(actions):
            if isinstance(action, ExecAction):
                if action.batch:
                    batches.setdefault(position, []).append(path)
                    continue
                assert execute_fn is not None
                if not await _run_exec(execute_fn, session_id, registry, cwd,
                                       stat_path, action, [path], out, errors):
                    break
            elif action.kind == "ls":
                before = len(errors)
                row = await _ls_row(match, registry, cwd, ns, stat_path,
                                    errors)
                if row is not None:
                    out.append(row)
                elif len(errors) > before:
                    exit_code = 1
            elif action.kind == "delete":
                # A structural row is skipped, not refused, the way Unix
                # leaves a mount point in place.
                if _structural(match, registry):
                    continue
                if not await _delete(match, registry, cwd, errors):
                    exit_code = 1
                    break
            else:
                out.append(
                    path.encode("utf-8") +
                    (b"\x00" if action.kind == "print0" else b"\n"))
    for position, action in enumerate(actions):
        paths = batches.get(position)
        if not isinstance(action, ExecAction) or not paths:
            continue
        assert execute_fn is not None
        if not await _run_exec(execute_fn, session_id, registry, cwd,
                               stat_path, action, paths, out, errors):
            exit_code = 1
    body = b"".join(out)
    return (body if body else None), b"".join(errors), exit_code
