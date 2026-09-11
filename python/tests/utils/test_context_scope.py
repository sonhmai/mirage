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
from contextvars import ContextVar

import pytest

from mirage.utils.context_scope import ContextScope


@pytest.mark.asyncio
async def test_scope_rebinds_tasks_threads_and_restores_after_failure():
    value = ContextVar("scope_test", default="empty")
    token = value.set("original")
    scope = ContextScope()
    value.reset(token)

    async def read():
        await asyncio.sleep(0)
        return value.get()

    async def fail():
        value.set("mutated")
        raise ValueError(value.get())

    assert await asyncio.to_thread(scope.call, value.get) == "original"
    assert await asyncio.gather(scope.run(read),
                                scope.run(read)) == ["original", "original"]
    with pytest.raises(ValueError, match="mutated"):
        await scope.run(fail)
    assert await scope.run(read) == "original"
    assert value.get() == "empty"


@pytest.mark.asyncio
async def test_scope_cancellation_reaches_the_engine():
    started, cancelled = asyncio.Event(), asyncio.Event()
    scope = ContextScope()

    async def run():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    task = asyncio.create_task(scope.run(run))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()
