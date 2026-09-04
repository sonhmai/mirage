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
from mirage.workspace.session import Session
from mirage.workspace.session.rng import next_random, seed_from


def test_seed_from_reads_the_word_as_an_integer():
    assert seed_from("42") == 42
    assert seed_from("-1") == (1 << 32) - 1
    assert seed_from("abc") == 0


def test_seeded_sequence_is_deterministic_and_bounded():
    a = Session(session_id="a")
    b = Session(session_id="b")
    seq_a = [next_random(a, "42" if i == 0 else a.vars[RANDOM].value) for i in range(5)]
    seq_b = [next_random(b, "42" if i == 0 else b.vars[RANDOM].value) for i in range(5)]
    assert seq_a == seq_b
    assert all(v is not None and 0 <= v <= RANDOM_MAX for v in seq_a)
    # The LCG from seed 42, so the two languages can pin one sequence.
    assert seq_a == [19081, 17033, 15269, 25461, 13856]


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


@pytest.mark.asyncio
async def test_random_expands_in_the_shell():
    ws = Workspace({"/": RAMResource()}, mode=MountMode.WRITE)
    io = await ws.execute('RANDOM=42; a=$RANDOM; RANDOM=42; b=$RANDOM; echo $a $b')
    assert await io.stdout_str() == "19081 19081\n"
    io = await ws.execute('echo $RANDOM $RANDOM')
    x, y = (await io.stdout_str()).split()
    assert x != y and x.isdigit() and y.isdigit()
    io = await ws.execute('unset RANDOM; echo "[$RANDOM]"')
    assert await io.stdout_str() == "[]\n"
