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

from mirage.commands.spec import SPECS
from mirage.commands.spec.parser import parse_command
from mirage.commands.spec.types import (CommandSpec, Operand, OperandKind,
                                        Option)


def test_grep_positional_pattern_then_path():
    parsed = parse_command(SPECS["grep"], ["orange", "/data/a.txt"], "/")
    assert parsed.texts() == ["orange"]
    assert parsed.paths() == ["/data/a.txt"]


def test_grep_dash_e_frees_positional_slot_for_path():
    parsed = parse_command(SPECS["grep"], ["-e", "orange", "/data/a.txt"], "/")
    assert parsed.flags["-e"] == "orange"
    assert parsed.texts() == []
    assert parsed.paths() == ["/data/a.txt"]


def test_grep_dash_e_with_flags_and_multiple_paths():
    parsed = parse_command(SPECS["grep"],
                           ["-n", "-e", "pat", "/a.txt", "/b.txt"], "/")
    assert parsed.flags["-n"] is True
    assert parsed.flags["-e"] == "pat"
    assert parsed.paths() == ["/a.txt", "/b.txt"]


def test_grep_dash_e_without_path_leaves_args_empty():
    parsed = parse_command(SPECS["grep"], ["-e", "orange"], "/")
    assert parsed.texts() == []
    assert parsed.paths() == []


def test_zgrep_dash_e_frees_positional_slot_for_path():
    parsed = parse_command(SPECS["zgrep"], ["-e", "orange", "/data/a.gz"], "/")
    assert parsed.flags["-e"] == "orange"
    assert parsed.texts() == []
    assert parsed.paths() == ["/data/a.gz"]


def test_provided_by_only_skips_slot_when_flag_present():
    spec = CommandSpec(
        options=(Option(short="-e", value_kind=OperandKind.TEXT), ),
        positional=(Operand(kind=OperandKind.TEXT, provided_by="-e"), ),
        rest=Operand(kind=OperandKind.PATH),
    )
    with_flag = parse_command(spec, ["-e", "pat", "/x"], "/")
    assert with_flag.paths() == ["/x"]
    without_flag = parse_command(spec, ["pat", "/x"], "/")
    assert without_flag.texts() == ["pat"]
    assert without_flag.paths() == ["/x"]
