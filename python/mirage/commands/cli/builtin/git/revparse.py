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

from dulwich.errors import NotTreeError
from dulwich.objects import Commit, ObjectID, ShaFile, Tag, Tree
from dulwich.objectspec import parse_commit
from dulwich.repo import BaseRepo

from mirage.commands.cli.builtin.git.constants import HEAD
from mirage.commands.cli.builtin.git.errors import AmbiguousArgumentError
from mirage.commands.cli.builtin.git.types import AncestryStep

ANCESTOR = "~"
PARENT = "^"
SUFFIXES = (ANCESTOR, PARENT)
# ``<rev>^{<type>}`` peels to a type; ``<rev>:<path>`` reads a tree.
PEEL_OPEN = "^{"
PEEL_CLOSE = "}"
PATH_MARK = ":"
COMMIT = "commit"
TREE = "tree"


def split_peel(revision: str) -> tuple[str, str | None]:
    """Split a trailing ``^{<type>}`` off a revision.

    ``HEAD^{tree}`` is a peel, not an ancestry step, and reading it as
    one is silent rather than loud: ``^`` with no digits means "first
    parent", so the suffix resolved to HEAD's parent commit and the
    caller was handed a different object than it asked for without a
    word. The braces tell the two apart, and git forbids both of them
    in a ref name, so nothing else can end this way.

    Args:
        revision (str): revision as the user spelled it.

    Returns:
        tuple[str, str | None]: the revision without the peel, and the
        type word inside it, empty for ``^{}`` and None when there is
        no peel at all.
    """
    if not revision.endswith(PEEL_CLOSE):
        return revision, None
    index = revision.rfind(PEEL_OPEN)
    if index < 0:
        return revision, None
    return revision[:index], revision[index + len(PEEL_OPEN):-1]


def split_revision(revision: str) -> tuple[str, tuple[AncestryStep, ...]]:
    """Split a revision into its base and its ancestry suffixes.

    ``HEAD~2^2`` is a base plus two steps. Splitting on the first ``~``
    or ``^`` is safe because git forbids both characters in ref names,
    so neither can belong to the base.

    Args:
        revision (str): revision as the user spelled it.
    """
    index = next(
        (i for i, ch in enumerate(revision) if ch in SUFFIXES),
        len(revision),
    )
    base, rest = revision[:index], revision[index:]
    steps: list[AncestryStep] = []
    position = 0
    while position < len(rest):
        kind = rest[position]
        position += 1
        digits = ""
        while position < len(rest) and rest[position] in "0123456789":
            digits += rest[position]
            position += 1
        if digits == "":
            count = 1
        else:
            count = int(digits)
        steps.append(AncestryStep(first_parent=kind == ANCESTOR, count=count))
    return base or HEAD, tuple(steps)


def _step(repo: BaseRepo, commit: Commit, step: AncestryStep,
          revision: str) -> Commit:
    """Apply one ancestry suffix to a commit.

    ``~n`` walks n generations along first parents; ``^n`` takes the
    n-th parent of this commit, and ``^0`` is the commit itself (git's
    way of spelling "the commit a tag points at").

    Args:
        repo (BaseRepo): repository to resolve parents against.
        commit (Commit): the commit the previous step produced.
        step (AncestryStep): the suffix to apply.
        revision (str): the whole revision, for error attribution.
    """
    if step.first_parent:
        for _ in range(step.count):
            if not commit.parents:
                raise AmbiguousArgumentError(revision)
            commit = _commit_at(repo, commit.parents[0], revision)
        return commit
    if step.count == 0:
        return commit
    if step.count > len(commit.parents):
        raise AmbiguousArgumentError(revision)
    return _commit_at(repo, commit.parents[step.count - 1], revision)


def _commit_at(repo: BaseRepo, sha: ObjectID, revision: str) -> Commit:
    """Load one commit by object id, or report the revision as unknown.

    Args:
        repo (BaseRepo): repository holding the object.
        sha (ObjectID): hex object id.
        revision (str): the whole revision, for error attribution.
    """
    try:
        obj = repo.object_store[sha]
    except KeyError as exc:
        raise AmbiguousArgumentError(revision) from exc
    if not isinstance(obj, Commit):
        raise AmbiguousArgumentError(revision)
    return obj


def resolve_commit(repo: BaseRepo, revision: str) -> Commit:
    """Resolve a revision to a commit, ancestry suffixes included.

    dulwich resolves refs, full ids and unambiguous short ids, but knows
    nothing about ``~`` and ``^``; those are applied here, on top of
    whatever its own parser returns.

    A ``^{}`` or ``^{commit}`` peel asks for exactly what this returns
    and is honoured; a peel naming any other type is a revision this
    caller cannot use, so it is refused rather than quietly stripped.

    Args:
        repo (BaseRepo): repository to resolve against.
        revision (str): revision as the user spelled it.
    """
    stem, want = split_peel(revision)
    if want is not None and want not in ("", COMMIT):
        raise AmbiguousArgumentError(revision)
    base, steps = split_revision(stem)
    try:
        commit = parse_commit(repo, base)
    except (KeyError, ValueError) as exc:
        raise AmbiguousArgumentError(revision) from exc
    for step in steps:
        commit = _step(repo, commit, step, revision)
    return commit


def object_at(repo: BaseRepo, revision: str) -> ShaFile:
    """The object one id names, whatever its type.

    Only an id, full or abbreviated: a ref and an ancestry suffix are
    the caller's to try first, and this is what is left for the tree or
    blob id git also takes wherever an object is wanted. An
    abbreviation is expanded through the store rather than looked up,
    since a store answers only a whole id.

    Args:
        repo (BaseRepo): the opened repository.
        revision (str): the id as the user spelled it.

    Raises:
        KeyError: when no object carries that id.
    """
    wanted = revision.encode()
    try:
        return repo[ObjectID(wanted)]
    except KeyError:
        found = list(repo.object_store.iter_prefix(wanted))
        if len(found) != 1:
            raise
        return repo[found[0]]


def _object_by_id(repo: BaseRepo, sha: ObjectID, revision: str) -> ShaFile:
    """Load one object by id, or report the revision as unknown.

    Args:
        repo (BaseRepo): repository holding the object.
        sha (ObjectID): hex object id.
        revision (str): the whole revision, for error attribution.
    """
    try:
        return repo.object_store[sha]
    except KeyError as exc:
        raise AmbiguousArgumentError(revision) from exc


def _peeled(repo: BaseRepo, obj: ShaFile, want: str, revision: str) -> ShaFile:
    """Follow a ``^{<type>}`` peel from the object the stem named.

    A tag is unwrapped first whatever the type asked for, which is what
    ``^{}`` means on its own. ``^{tree}`` then takes a commit's tree,
    git's one implicit step; every other spelling has to already name
    the type it asks for, so ``HEAD^{blob}`` is refused rather than
    answered with something else.

    Args:
        repo (BaseRepo): the opened repository.
        obj (ShaFile): the object the stem resolved to.
        want (str): the type word inside the braces, empty for ``^{}``.
        revision (str): the whole revision, for error attribution.
    """
    while isinstance(obj, Tag):
        obj = _object_by_id(repo, obj.object[1], revision)
    if want == "":
        return obj
    if want == TREE and isinstance(obj, Commit):
        obj = _object_by_id(repo, obj.tree, revision)
    if obj.type_name.decode() != want:
        raise AmbiguousArgumentError(revision)
    return obj


def _at_path(repo: BaseRepo, rev: str, path: str, revision: str) -> ShaFile:
    """The object a ``<rev>:<path>`` names inside a tree.

    Args:
        repo (BaseRepo): the opened repository.
        rev (str): the revision before the colon, HEAD when empty.
        path (str): the path after it, repository-relative.
        revision (str): the whole revision, for error attribution.
    """
    holder = resolve_object(repo, rev)
    if isinstance(holder, Commit):
        holder = _object_by_id(repo, holder.tree, revision)
    if not isinstance(holder, Tree):
        raise AmbiguousArgumentError(revision)
    try:
        _mode, sha = holder.lookup_path(repo.object_store.__getitem__,
                                        path.encode())
    except (KeyError, NotTreeError, ValueError) as exc:
        raise AmbiguousArgumentError(revision) from exc
    return _object_by_id(repo, sha, revision)


def resolve_object(repo: BaseRepo, revision: str) -> ShaFile:
    """The object a revision names, whatever type it turns out to be.

    The whole grammar a caller that wants an object rather than a
    commit has to read: ``HEAD:a.txt`` is the blob at a path,
    ``HEAD^{tree}`` is a commit's tree, ``v1^{}`` is what a tag points
    at, and a bare id of any type is itself. A commit-ish is tried
    first because that is what the operand is normally spelled with,
    and it is the only reading that understands ancestry.

    Args:
        repo (BaseRepo): repository to resolve against.
        revision (str): revision as the user spelled it.
    """
    if PATH_MARK in revision:
        rev, _, path = revision.partition(PATH_MARK)
        return _at_path(repo, rev or HEAD, path, revision)
    stem, want = split_peel(revision)
    if want is None:
        try:
            return resolve_commit(repo, revision)
        except AmbiguousArgumentError:
            # Not a commit-ish. A raw id is read as itself before the
            # revision is called unresolved, and the type is kept,
            # since it is what a caller records.
            try:
                return object_at(repo, revision)
            except (KeyError, ValueError) as exc:
                raise AmbiguousArgumentError(revision) from exc
    return _peeled(repo, resolve_object(repo, stem), want or "", revision)
