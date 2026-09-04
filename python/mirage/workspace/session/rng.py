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

from mirage.shell.constants import (RANDOM, RANDOM_INCREMENT, RANDOM_MAX,
                                    RANDOM_MODULUS, RANDOM_MULTIPLIER,
                                    RANDOM_UNSET)
from mirage.shell.variable import ShellVar
from mirage.workspace.session.session import Session


def seed_from(word: str) -> int:
    """The generator seed an assignment `RANDOM=word` sets.

    bash reads the word as an integer and a word that is not one as 0.

    Args:
        word (str): the assigned value.
    """
    body = word[1:] if word[:1] in ("-", "+") else word
    if not body.isdigit():
        return 0
    return int(word) % RANDOM_MODULUS


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

    Args:
        session (Session): the session holding the generator state.
        stored (str | None): the store's current value for RANDOM, from
            the visible env.
    """
    if session._random_seed == RANDOM_UNSET or (stored is None and
                                                session._random_seed
                                                is not None):
        return None
    if stored is not None and stored != session._random_seed:
        session._random_state = seed_from(stored)
    elif session._random_state is None:
        session._random_state = time.time_ns() % RANDOM_MODULUS
    state = (session._random_state * RANDOM_MULTIPLIER +
             RANDOM_INCREMENT) % RANDOM_MODULUS
    session._random_state = state
    value = (state >> 16) & RANDOM_MAX
    word = str(value)
    existing = session.vars.get(RANDOM)
    session.vars[RANDOM] = (replace(existing, value=word)
                            if existing is not None else ShellVar(word))
    session._random_seed = word
    return value
