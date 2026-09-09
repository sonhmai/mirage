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

import asyncio

import pytest

from mirage.workspace.abort import (ABORT_JOIN_SECONDS, MirageAbortError,
                                    run_cancellable)


@pytest.mark.asyncio
async def test_abort_wins_over_a_task_that_finished_in_the_same_tick():
    # The event is the caller's; once it is set the answer is the abort,
    # even when the task reached its return in the same tick, and the
    # task's finally has run before the caller hears back.
    cancel = asyncio.Event()
    finished: list[bool] = []

    async def body() -> int:
        try:
            cancel.set()
            await asyncio.sleep(0)
            return 1
        finally:
            finished.append(True)

    with pytest.raises(MirageAbortError):
        await run_cancellable(body(), cancel)
    assert finished == [True]


@pytest.mark.asyncio
async def test_a_task_that_finishes_first_reports_its_own_outcome():
    cancel = asyncio.Event()

    async def body() -> int:
        await asyncio.sleep(0)
        return 3

    assert await run_cancellable(body(), cancel) == 3
    assert not cancel.is_set()


@pytest.mark.asyncio
async def test_a_stalled_task_is_cancelled_and_joined():
    cancel = asyncio.Event()
    unwound: list[bool] = []

    async def body() -> None:
        try:
            await asyncio.Event().wait()
        finally:
            unwound.append(True)

    asyncio.get_running_loop().call_later(0.01, cancel.set)
    with pytest.raises(MirageAbortError):
        await run_cancellable(body(), cancel)
    assert unwound == [True]


@pytest.mark.asyncio
async def test_an_epilogue_that_outlives_the_grace_is_cancelled_too():
    # The first cancel lands on the body; the task's finally then awaits
    # something that never settles. The caller is still released, after
    # the grace, and the task is done when it is.
    cancel = asyncio.Event()
    steps: list[str] = []

    async def body() -> None:
        try:
            await asyncio.Event().wait()
        finally:
            steps.append("epilogue")
            try:
                await asyncio.Event().wait()
            finally:
                steps.append("released")

    asyncio.get_running_loop().call_later(0.01, cancel.set)
    started = asyncio.get_running_loop().time()
    with pytest.raises(MirageAbortError):
        await run_cancellable(body(), cancel)
    elapsed = asyncio.get_running_loop().time() - started
    assert steps == ["epilogue", "released"]
    assert ABORT_JOIN_SECONDS <= elapsed < ABORT_JOIN_SECONDS + 1
