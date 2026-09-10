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

from dataclasses import dataclass

from dulwich.refs import Ref

from mirage.commands.cli.builtin.git.checkout import (move_head,
                                                      previous_position)
from mirage.commands.cli.builtin.git.constants import HEAD
from mirage.commands.cli.builtin.git.errors import (  # yapf: disable
    BranchExistsError, BranchExpectedError, DetachWithCreateError, GitError,
    InvalidBranchNameError, InvalidReferenceError, MissingBranchArgumentError,
    NoWorkspaceError, OneReferenceError, UnknownSwitchError)
from mirage.commands.cli.builtin.git.format import short, subject
from mirage.commands.cli.builtin.git.objects import abbrev_for
from mirage.commands.cli.builtin.git.refs import (BRANCH_PREFIX, TAG_PREFIX,
                                                  read_head, valid_ref_name)
from mirage.commands.cli.builtin.git.revparse import resolve_commit
from mirage.commands.cli.builtin.git.session import opened
from mirage.commands.cli.builtin.git.util import (check_operands, fatal,
                                                  links_of)
from mirage.commands.cli.types import CLIDoors, CLIInvocation
from mirage.commands.spec.types import FlagView
from mirage.io.stream import yield_bytes
from mirage.io.types import ByteSource, IOResult

REMOTES_PREFIX = "refs/remotes/"
COMMIT = "commit"
TAG = "tag"
REMOTE_BRANCH = "remote branch"


@dataclass(frozen=True, slots=True)
class SwitchFlags:
    """The parsed shape of a ``git switch`` invocation.

    Args:
        create (str | None): ``-c``, the branch to create and switch to.
        detach (bool): ``--detach``, leave HEAD on the commit itself.
    """
    create: str | None
    detach: bool


def parse_flags(fl: FlagView) -> SwitchFlags:
    """Read the raw switch flag kwargs into a frozen struct.

    Args:
        fl (FlagView): spec-validated view over the raw flag kwargs.
    """
    return SwitchFlags(create=fl.as_str("create"), detach=fl.as_bool("detach"))


def expected_kind(known: set[Ref], name: str) -> str:
    """What a non-branch operand named, for the refusal that says so.

    git tells a tag and a remote-tracking branch apart from a bare
    commit in the same sentence, so the refusal can say which one the
    caller reached for.

    Args:
        known (set[Ref]): every ref the repository publishes.
        name (str): the operand as the user spelled it.
    """
    if Ref(f"{TAG_PREFIX}{name}".encode()) in known:
        return TAG
    if Ref(f"{REMOTES_PREFIX}{name}".encode()) in known:
        return REMOTE_BRANCH
    return COMMIT


async def switch(
        inv: CLIInvocation[None]) -> tuple[ByteSource | None, IOResult]:
    """Switch to a branch, creating it under ``-c``.

    The same move ``checkout`` makes, with a narrower grammar: only a
    branch is accepted, so a commit, tag or remote-tracking name is
    refused unless ``--detach`` says that a detached HEAD is what was
    meant. That is the whole reason git split the verb off, and it
    holds here for the same reason: a detached HEAD is the state an
    agent loses commits in.

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
        check_operands(texts, UnknownSwitchError)
        flags = parse_flags(fl)
        creating = flags.create is not None
        if creating and flags.detach:
            raise DetachWithCreateError()
        if len(texts) > 1:
            raise OneReferenceError()
        if not creating and not texts:
            raise MissingBranchArgumentError()
        repo, location = await opened(fl, doors)
        head = await read_head(dispatch, location.gitdir)
        known = repo.refs.allkeys()
        if flags.create is not None:
            target = flags.create
            ref = Ref(f"{BRANCH_PREFIX}{target}".encode())
            if ref in known:
                raise BranchExistsError(target)
            start = texts[0] if texts else HEAD
            try:
                commit = resolve_commit(repo, start)
            except GitError as exc:
                raise InvalidReferenceError(start) from exc
            # After the start point and before anything is written,
            # which is git's own order. A ref is a path below .git, so
            # an unchecked name reaches write_ref as one: -c
            # ../../config would land on the repository's own
            # configuration rather than on a branch.
            if not valid_ref_name(target):
                raise InvalidBranchNameError(target)
            attached = True
        else:
            target = texts[0]
            ref = Ref(f"{BRANCH_PREFIX}{target}".encode())
            if not flags.detach and target == head.branch:
                return None, IOResult(
                    stderr=f"Already on '{target}'\n".encode())
            try:
                commit = resolve_commit(repo, target)
            except GitError as exc:
                raise InvalidReferenceError(target) from exc
            attached = not flags.detach and ref in known
            if not flags.detach and not attached:
                raise BranchExpectedError(expected_kind(known, target), target)
        dirty = await move_head(dispatch, stat_path, links_of(doors), repo,
                                location, head, commit, target,
                                ref if attached else None, creating)
    except GitError as exc:
        return fatal(exc)
    carried = "".join(f"M\t{path}\n" for path in sorted(dirty))
    note = previous_position(repo, head)
    if attached:
        verb = "Switched to a new branch" if creating else "Switched to branch"
        note += f"{verb} '{target}'\n"
    else:
        note += (f"HEAD is now at {short(commit.id, abbrev_for(repo))} "
                 f"{subject(commit)}\n")
    return yield_bytes(carried.encode()), IOResult(stderr=note.encode())
