import asyncio
from types import SimpleNamespace

import pytest

from mirage.io import checkpoint as checkpoint_mod
from mirage.io.checkpoint import Checkpoint


@pytest.mark.asyncio
async def test_run_yields_only_after_budget(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(checkpoint_mod, "time",
                        SimpleNamespace(monotonic=lambda: clock[0]))
    point = Checkpoint()
    ran: list[int] = []
    asyncio.get_running_loop().call_soon(ran.append, 1)

    await point.run()
    assert ran == []

    clock[0] += checkpoint_mod.YIELD_INTERVAL * 2
    await point.run()
    assert ran == [1]

    asyncio.get_running_loop().call_soon(ran.append, 2)
    await point.run()
    assert ran == [1]
