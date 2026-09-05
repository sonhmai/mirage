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

import time
from dataclasses import replace

from mirage.shell.arith import evaluate_arith
from mirage.shell.constants import (RANDOM, RANDOM_A, RANDOM_M, RANDOM_MAX,
                                    RANDOM_MODULUS, RANDOM_Q, RANDOM_R,
                                    RANDOM_UNSET, RANDOM_ZERO_SEED)
from mirage.shell.errors import ArithError
from mirage.shell.variable import ShellVar
from mirage.workspace.session.session import Session
from mirage.workspace.session.state import session_elements, visible_env


def seed_from(word: str, session: Session) -> int | None:
    """The generator seed an assignment `RANDOM=word` sets, or None.

    bash evaluates the word as arithmetic (``assign_random`` calls
    ``evalexp``), so ``RANDOM=1+2`` seeds 3, ``RANDOM=0x10`` seeds 16,
    ``RANDOM=x`` reads ``x``, and an unset name is 0. A word that does
    not evaluate (``RANDOM=1.5``) is bash's arithmetic error: the
    message prints and the generator is left alone, which is the None
    here. The seed truncates to 32 bits, as ``sbrand`` does.

    Args:
        word (str): the assigned value.
        session (Session): the session the word's names resolve in.
    """
    try:
        value = evaluate_arith(word,
                               visible_env(session),
                               elements=session_elements(session)).value
    except ArithError:
        return None
    return value % RANDOM_MODULUS


def step_state(state: int) -> int:
    """One step of bash's generator (``intrand32``): Park-Miller through
    Schrage's method, a zero state stepping from the fixed seed.

    Args:
        state (int): the generator state, a 32-bit value.
    """
    ret = RANDOM_ZERO_SEED if state == 0 else state
    high = ret // RANDOM_Q
    low = ret - RANDOM_Q * high
    step = RANDOM_A * low - RANDOM_R * high
    return step + RANDOM_M if step < 0 else step


def value_of(state: int) -> int:
    """The ``$RANDOM`` value a state renders as (``brand``): the two
    16-bit halves folded, keeping 15 bits.

    Args:
        state (int): the generator state after a step.
    """
    return ((state >> 16) ^ (state & 0xFFFF)) & RANDOM_MAX


def _last_value(seed: str | None) -> int:
    """The value the previous draw returned, read off the word it wrote
    back; 0 after a reseed, which is what ``sbrand`` resets it to."""
    return int(seed) if seed is not None and seed.isdigit() else 0


def next_random(session: Session, stored: str | None) -> int | None:
    """Step ``$RANDOM`` and return its value, or None once it is unset.

    The variable store is the seed door and the record, as in bash: an
    assignment ``RANDOM=42`` reseeds because the stored word differs
    from the value the last read wrote back, and every read writes its
    value back so ``declare -p RANDOM`` shows it and a repeated
    ``RANDOM=42`` reseeds again. ``unset RANDOM`` strips the special
    meaning in bash, so the name reads as an ordinary unset variable
    from then on: ``unset_var`` marks the session (RANDOM_UNSET) and a
    store that no longer holds the name after a read says the same. The
    write-back is the shell's own bookkeeping on a name it defines, not
    a user assignment, so it does not pass the session plane's door.

    A draw never returns the value before it (bash's ``get_random_number``
    redraws on a repeat), and a reseed or a fresh generator starts that
    comparison from 0, as ``sbrand`` does. A stored word that does not
    evaluate is the assignment bash refused: the sequence continues as
    if it had not happened. The refusal's message is bash's at
    assignment time, which a reseed decided at the read cannot voice.

    Args:
        session (Session): the session holding the generator state.
        stored (str | None): the store's current value for RANDOM, from
            the visible env.
    """
    if session._random_seed == RANDOM_UNSET or (
            stored is None and session._random_seed is not None):
        return None
    seed = (seed_from(stored, session)
            if stored is not None and stored != session._random_seed else None)
    if seed is not None:
        state = seed
        last = 0
    elif session._random_state is None:
        state = time.time_ns() % RANDOM_MODULUS
        last = 0
    else:
        state = session._random_state
        last = _last_value(session._random_seed)
    while True:
        state = step_state(state)
        value = value_of(state)
        if value != last:
            break
    session._random_state = state
    word = str(value)
    existing = session.vars.get(RANDOM)
    session.vars[RANDOM] = (replace(existing, value=word)
                            if existing is not None else ShellVar(word))
    session._random_seed = word
    return value
