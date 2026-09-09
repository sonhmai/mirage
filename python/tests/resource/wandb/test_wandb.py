from unittest.mock import AsyncMock

import pytest

from mirage import MountMode, Workspace
from mirage.resource.wandb import WandbConfig, WandbResource


@pytest.mark.asyncio
async def test_mount_scopes_and_indexes_are_isolated() -> None:
    first = WandbResource(WandbConfig(entities=["lab", "lab"]))
    second = WandbResource(WandbConfig(entities=["other"]))
    first.accessor.client.request = AsyncMock()
    second.accessor.client.request = AsyncMock()
    workspaces = [
        Workspace({"/wandb": resource}) for resource in [first, second]
    ]
    try:
        for ws, entity, excluded in zip(workspaces, ["lab", "other"],
                                        ["other", "lab"]):
            result = await ws.execute("ls /wandb")
            assert result.exit_code == 0
            assert result.stdout.decode().split() == [entity]
            assert (await ws.execute(f"ls /wandb/{excluded}")).exit_code != 0
        first.accessor.client.request.assert_not_awaited()
        second.accessor.client.request.assert_not_awaited()
    finally:
        for ws in workspaces:
            await ws.close()


@pytest.mark.asyncio
async def test_write_workspace_cannot_mutate_wandb_or_invoke_a_wandb_cli(
) -> None:
    resource = WandbResource(WandbConfig(entities=["lab"]))
    resource.accessor.client.request = AsyncMock()
    ws = Workspace({"/wandb": resource}, mode=MountMode.WRITE)
    try:
        for command in [
                "echo bad > /wandb/lab/project/run/summary.json",
                "mkdir /wandb/lab/new-project",
                "type -t wandb",
        ]:
            assert (await ws.execute(command)).exit_code != 0
        resource.accessor.client.request.assert_not_awaited()
    finally:
        await ws.close()
