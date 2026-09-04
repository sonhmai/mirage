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

from mirage.ops.types import StatPath
from mirage.types import PathSpec
from mirage.utils.dates import iso_timestamp, timestamp_iso
from mirage.workspace.expand.classify.path import classify_bare_path
from mirage.workspace.mount import MountRegistry
from mirage.workspace.mount.namespace import Namespace
from mirage.workspace.mount.namespace.overlay import merge_overlay_stat

NEWER = "-newer"
NEWERMT = "-newermt"


def missing_reference_line(ref: str) -> bytes:
    """GNU's line for a ``-newer`` reference that does not exist.

    Args:
        ref (str): the reference as typed.
    """
    return f"find: '{ref}': No such file or directory\n".encode()


async def resolve_newer_refs(
    tokens: list[str],
    refs: list[str],
    registry: MountRegistry,
    cwd: str,
    stat_path: StatPath,
    namespace: Namespace | None = None,
) -> tuple[list[str], bytes | None]:
    """Rewrite every ``-newer FILE`` in an expression into ``-newermt``.

    A backend's find op sees the expression as tokens and can stat
    nothing outside its own mount, while the reference may live on any
    mount and carry a namespace-overlay mtime (a ``touch -d`` on a
    backend that stores none). So the executor resolves each reference
    through the dispatcher once, before any backend parses the
    expression, and hands down a timestamp that needs no further I/O.
    A reference that does not exist is GNU's error, exit 1, and no walk
    runs.

    Args:
        tokens (list[str]): the expression tokens as typed.
        refs (list[str]): the reference operands, in expression order.
        registry (MountRegistry): mount registry, for classification.
        cwd (str): the session's working directory.
        stat_path (StatPath): the dispatcher's stat probe.
        namespace (Namespace | None): the name plane, whose attr
            overlay may hold the reference's mtime.

    Returns:
        The rewritten tokens and None, or the tokens untouched and the
        error line for the first reference that does not exist.
    """
    times: list[str] = []
    for ref in refs:
        scope = classify_bare_path(ref, registry, cwd)
        virtual = scope.virtual if isinstance(scope, PathSpec) else ref
        stat = await stat_path(virtual)
        if stat is None:
            return tokens, missing_reference_line(ref)
        if namespace is not None:
            stat = merge_overlay_stat(namespace.meta_for(virtual), stat)
        # A reference with no reported mtime is never "older" than
        # anything: the epoch bound admits every dated entry, which is
        # the most a backend without times can honestly say.
        times.append(timestamp_iso(_modified_or_epoch(stat.modified)) or "")
    rewritten: list[str] = []
    i = 0
    n = 0
    while i < len(tokens):
        if tokens[i] == NEWER and i + 1 < len(tokens) and n < len(times):
            rewritten.extend((NEWERMT, times[n]))
            n += 1
            i += 2
            continue
        rewritten.append(tokens[i])
        i += 1
    return rewritten, None


def _modified_or_epoch(modified: str | None) -> float:
    ts = iso_timestamp(modified)
    return ts if ts is not None else 0.0
