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

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class OperandKind(str, Enum):
    NONE = "none"
    PATH = "path"
    TEXT = "text"


@dataclass(frozen=True)
class Option:
    """One flag accepted by a command.

    Args:
        short (str | None): short form, e.g. "-e".
        long (str | None): long form, e.g. "--max-depth".
        value_kind (OperandKind): NONE for boolean flags; TEXT or PATH for
            value flags. PATH values are cwd-resolved and routed for mount
            dispatch, and reach the command as PathSpec.
        numeric_shorthand (bool): treat "-<digits>" as this flag's value
            (e.g. head -5).
        repeatable (bool): repeated occurrences accumulate into a list
            instead of last-wins (argparse append semantics, e.g. grep -e).
            TEXT values arrive as list[str]; PATH values are each resolved
            and routed and arrive as list[PathSpec].
        description (str | None): help text.
    """
    short: str | None = None
    long: str | None = None
    value_kind: OperandKind = OperandKind.NONE
    numeric_shorthand: bool = False
    repeatable: bool = False
    description: str | None = None


@dataclass(frozen=True)
class Operand:
    """One positional argument slot.

    Args:
        kind (OperandKind): PATH operands are cwd-resolved and routed for
            mount dispatch; TEXT operands pass through verbatim.
        provided_by (tuple[str, ...]): flags that supply this operand's
            value. When any is present the slot is skipped and remaining
            args classify as rest (e.g. grep's pattern with -e/-f).
    """
    kind: OperandKind = OperandKind.PATH
    provided_by: tuple[str, ...] = ()


@dataclass(frozen=True)
class CommandSpec:
    options: tuple[Option, ...] = ()
    positional: tuple[Operand, ...] = ()
    rest: Operand | None = None
    ignore_tokens: frozenset[str] = frozenset()
    description: str | None = None


class FlagView:
    """Typed read-only view over raw flag kwargs.

    Commands receive flags as an untyped mapping from the dispatcher; this
    view is the one sanctioned way to read them, replacing ad-hoc
    `flags.get(...) is True` and isinstance chains.

    Args:
        flags (Mapping[str, object] | None): raw flag kwargs.
    """

    def __init__(self, flags: Mapping[str, object] | None) -> None:
        self._flags = flags or {}

    def bool(self, name: str) -> bool:
        return self._flags.get(name) is True

    def int(self, name: str) -> int | None:
        value = self._flags.get(name)
        return int(value) if isinstance(value, str) else None

    def str(self, name: str) -> str | None:
        value = self._flags.get(name)
        return value if isinstance(value, str) else None

    def list(self, name: str) -> list[str]:
        value = self._flags.get(name)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)]
        if isinstance(value, str):
            return [value]
        return []

    def raw(self, name: str) -> object:
        return self._flags.get(name)


@dataclass
class ParsedArgs:
    flags: dict[str, str | bool | list[str]]
    args: list[tuple[str, OperandKind]]
    cache_paths: list[str] = field(default_factory=list)
    path_flag_values: list[str] = field(default_factory=list)
    raw_operands: list[tuple[str, OperandKind]] = field(default_factory=list)
    text_flag_values: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def paths(self) -> list[str]:
        return [v for v, k in self.args if k == OperandKind.PATH]

    def routing_paths(self) -> list[str]:
        return self.paths() + self.path_flag_values

    def texts(self) -> list[str]:
        return [v for v, k in self.args if k == OperandKind.TEXT]

    def flag(self, name: str, default: Any = None) -> Any:
        return self.flags.get(name, default)
