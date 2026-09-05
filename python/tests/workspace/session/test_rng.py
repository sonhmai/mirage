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

import pytest

from mirage import MountMode, RAMResource, Workspace
from mirage.shell.constants import RANDOM, RANDOM_MAX
from mirage.shell.variable import ShellVar
from mirage.workspace.session import Session
from mirage.workspace.session.rng import next_random, seed_from
from mirage.workspace.session.state import seed_var


def test_seed_from_evaluates_the_word_as_arithmetic():
    s = Session(session_id="s")
    s.vars["x"] = ShellVar("42")
    assert seed_from("42", s) == 42
    assert seed_from("-1", s) == (1 << 32) - 1
    assert seed_from("abc", s) == 0
    assert seed_from("", s) == 0
    assert seed_from("1+2", s) == 3
    assert seed_from("0x10", s) == 16
    assert seed_from("010", s) == 8
    assert seed_from("x", s) == 42
    assert seed_from("x*2", s) == 84
    assert seed_from("1.5", s) is None
    assert seed_from("1+", s) is None
    assert seed_from("08", s) is None


def test_an_unevaluable_word_leaves_the_generator_alone():
    # bash 5.2.37: `RANDOM=0; echo $RANDOM; RANDOM=1.5; echo $RANDOM`
    # prints the error for 1.5 and then 24386, the second draw of seed 0.
    s = Session(session_id="s")
    assert next_random(s, "0") == 20814
    assert next_random(s, "1.5") == 24386
    assert next_random(s, s.vars[RANDOM].value) == 149


@pytest.mark.parametrize("seed,expected", [
    ("1", [16807, 10791, 19566]),
    ("0", [20814, 24386, 149]),
    ("-1", [16807, 10791, 19566]),
    ("4294967338", [17772, 26794, 1435]),
    ("32768", [8403, 3502, 14043]),
    ("1+2", [17653, 593, 9386]),
    ("0x10", [6772, 8817, 18150]),
    ("abc", [20814, 24386, 149]),
])
def test_seeded_sequences_are_bash_5_2s(seed, expected):
    # Pinned against bash 5.2.37 on debian:stable-slim. -1 truncates to
    # 32 bits, 4294967338 is 42 past 2**32, seed 32768 renders 0 on its
    # first step, which the no-repeat rule redraws, and the last three
    # are arithmetic words: 3, 16, and an unset name.
    s = Session(session_id="s")
    drawn = [
        next_random(s, seed if i == 0 else s.vars[RANDOM].value)
        for i in range(3)
    ]
    assert drawn == expected


def test_seeded_sequence_is_deterministic_and_bounded():
    a = Session(session_id="a")
    b = Session(session_id="b")
    seq_a = [
        next_random(a, "42" if i == 0 else a.vars[RANDOM].value)
        for i in range(5)
    ]
    seq_b = [
        next_random(b, "42" if i == 0 else b.vars[RANDOM].value)
        for i in range(5)
    ]
    assert seq_a == seq_b
    assert all(v is not None and 0 <= v <= RANDOM_MAX for v in seq_a)
    # bash 5.2's sequence from seed 42, so both languages pin bash's.
    assert seq_a == [17772, 26794, 1435, 24388, 11074]


def test_write_back_reseeds_only_on_a_new_word():
    s = Session(session_id="s")
    first = next_random(s, "7")
    stored = s.vars[RANDOM].value
    assert stored == str(first)
    second = next_random(s, stored)
    assert second != first or s.vars[RANDOM].value != stored


def test_unset_after_a_read_strips_the_meaning():
    s = Session(session_id="s")
    assert next_random(s, None) is not None
    assert next_random(s, None) is None


def test_a_child_shell_reseeds_and_the_parent_gets_its_state_back():
    s = Session(session_id="s")
    parent = [next_random(s, "42"), next_random(s, s.vars[RANDOM].value)]
    saved = s.snapshot()
    child = next_random(s, s.vars[RANDOM].value)
    assert s._random_state is not None
    s.restore(saved)
    assert next_random(s, s.vars[RANDOM].value) == 1435
    assert parent == [17772, 26794] and child != 1435


def test_a_child_shell_does_not_replay_a_pending_seed():
    s = Session(session_id="s")
    seed_var(s, RANDOM, "42")
    s.snapshot()
    assert s._random_seed == "42" and s._random_state is None
    unset = Session(session_id="u")
    next_random(unset, None)
    assert next_random(unset, None) is None
    unset.snapshot()
    assert next_random(unset, None) is None


@pytest.mark.asyncio
async def test_random_expands_in_the_shell():
    ws = Workspace({"/": RAMResource()}, mode=MountMode.WRITE)
    io = await ws.execute(
        'RANDOM=42; a=$RANDOM; RANDOM=42; b=$RANDOM; echo $a $b')
    assert await io.stdout_str() == "17772 17772\n"
    io = await ws.execute('echo $RANDOM $RANDOM')
    x, y = (await io.stdout_str()).split()
    assert x != y and x.isdigit() and y.isdigit()
    io = await ws.execute(
        'RANDOM=42; a=$RANDOM; RANDOM=42; (: $RANDOM); b=$RANDOM; echo $a $b')
    assert await io.stdout_str() == "17772 17772\n"
    io = await ws.execute(
        "RANDOM='1+2'; a=$RANDOM; RANDOM=0x10; b=$RANDOM; x=42; RANDOM=x; "
        "c=$RANDOM; RANDOM=0; d=$RANDOM; RANDOM=1.5; e=$RANDOM; "
        "echo $a $b $c $d $e")
    assert await io.stdout_str() == "17653 6772 17772 20814 24386\n"
    io = await ws.execute('unset RANDOM; echo "[$RANDOM]"')
    assert await io.stdout_str() == "[]\n"


@pytest.mark.asyncio
@pytest.mark.parametrize("child", [
    'echo $RANDOM | cat >/dev/null',
    'echo x | { read x; : $RANDOM; }',
    'x=$(echo $RANDOM)',
    'x=`echo $RANDOM`',
    'x=$(echo $RANDOM # trailing comment\n)',
    'x=$(echo $(echo $RANDOM))',
    'x=$(: $RANDOM; exit 7)',
    'echo x | { : $RANDOM; exit 7; }',
])
@pytest.mark.parametrize("draw_first", [False, True])
async def test_child_random_reads_preserve_the_parent_sequence(
        child, draw_first):
    ws = Workspace({"/": RAMResource()}, mode=MountMode.WRITE)
    try:
        prefix = 'RANDOM=42; ' + (': $RANDOM; ' if draw_first else '')
        io = await ws.execute(prefix + child + '; echo $RANDOM')
        assert io.exit_code == 0
        assert await io.stdout_str() == ('26794\n'
                                         if draw_first else '17772\n')
        assert await io.stderr_str() == ''
    finally:
        await ws.close()
