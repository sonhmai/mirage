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
from mirage.shell.variable import ShellVar
from mirage.workspace.session.session import Session
from mirage.workspace.session.state import session_elements, visible_env


def seed_from(word: str, session: Session) -> int:
    """Evaluate a host-supplied seed; invalid arithmetic propagates.

    Args:
        word (str): the seed expression.
        session (Session): the session the expression reads.
    """
    value = evaluate_arith(word,
                           visible_env(session),
                           elements=session_elements(session)).value
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


def next_random(session: Session, stored: str | None) -> int | None:
    """Draw from the session generator, or None after RANDOM is unset.

    Shell assignments validate and seed at the session door. A host-seeded
    variable is consumed here on its first read. The last draw is separate
    from the stored word because a reseed resets repeat suppression to zero.

    Args:
        session (Session): generator and variable state.
        stored (str | None): the visible RANDOM value.
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
        last = session._random_last
    while True:
        state = step_state(state)
        value = value_of(state)
        if value != last:
            break
    session._random_state = state
    session._random_last = value
    word = str(value)
    existing = session.vars.get(RANDOM)
    session.vars[RANDOM] = (replace(existing, value=word)
                            if existing is not None else ShellVar(word))
    session._random_seed = word
    return value
