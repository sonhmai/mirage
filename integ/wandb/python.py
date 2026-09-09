import asyncio
import json
import os
from pathlib import Path

from requests import request_checks

from mirage import MountMode, Workspace
from mirage.core.wandb.read import read, read_stream
from mirage.core.wandb.stat import stat
from mirage.resource.registry import build_resource
from mirage.resource.wandb import WandbConfig, WandbResource
from mirage.types import PathSpec


def path(key: str) -> PathSpec:
    return PathSpec.from_str_path("/wandb/" + key, resource_path=key)


async def main() -> None:
    resource = build_resource(
        "wandb", {
            "entities": ["lab", "other"],
            "api_key": os.environ["WANDB_API_KEY"],
            "base_url": os.environ["WANDB_BASE_URL"],
            "page_size": 2
        })
    assert isinstance(resource, WandbResource)
    ws = Workspace({"/wandb": resource}, mode=MountMode.READ)
    results = []
    try:
        for case in json.loads(
                Path(__file__).with_name("cases.json").read_text()):
            result = await ws.execute(case["command"])
            results.append({
                "name": case["name"],
                "stdout": result.stdout.decode(),
                "stderr": (result.stderr or b"").decode(),
                "exit_code": result.exit_code
            })
        values = await asyncio.gather(
            read(resource.accessor,
                 path("lab/experiments/run-a/summary.json")),
            read(resource.accessor,
                 path("other/experiments/run-a/summary.json")))
        assert [json.loads(value) for value in values] == [{
            "score": 0.4
        }, {
            "score": 42
        }]
        assert json.loads(await
                          read(resource.accessor,
                               path("lab/experiments/run-a/config.json"))) == {
                                   "lr": 0.01,
                                   "label": "café"
                               }
        assert (await
                stat(resource.accessor,
                     path("lab/experiments/run-a/history.jsonl"))).size is None
        assert (await
                stat(resource.accessor,
                     path("lab/experiments/run-a/files/notes.txt"))).size == 6
        assert await read(
            resource.accessor,
            path("lab/experiments/run-a/files/nested/model.bin")) == bytes(
                [0, 1, 2, 255])
        assert os.environ["WANDB_API_KEY"] not in str(resource.get_state())
        for page_size in (1, 5):
            narrow = WandbResource(
                WandbConfig(entities=['lab'],
                            api_key=os.environ['WANDB_API_KEY'],
                            base_url=os.environ['WANDB_BASE_URL'],
                            page_size=page_size))
            try:
                data = await read(narrow.accessor,
                                  path('lab/experiments/run-a/history.jsonl'))
                assert [
                    json.loads(line)['_step'] for line in data.splitlines()
                ] == [0, 1, 4, 5]
            finally:
                await narrow.close()
        stream = read_stream(resource.accessor,
                             path("lab/experiments/run-long/history.jsonl"))
        assert await anext(stream)
        await stream.aclose()
        unauth = WandbResource(
            WandbConfig(entities=["lab"],
                        api_key="invalid",
                        base_url=os.environ["WANDB_BASE_URL"]))
        try:
            await unauth.accessor.client.projects("lab")
        except PermissionError:
            auth_failed = True
        else:
            auth_failed = False
        finally:
            await unauth.close()
        assert auth_failed
        for command in [
                "cat /wandb/lab/experiments/run-a",
                "cat /wandb/lab/experiments/run-a/files/nested",
                "cat /wandb/lab/experiments/run-a/summary.json/child",
                "cat /wandb/lab/experiments/nope/history.jsonl",
                "cat /wandb/lab/experiments/nope/run.json", "cat /wandb/nope",
                "cat /wandb/lab/experiments/run-a/files/nope",
                "echo bad > /wandb/lab/experiments/run-a/summary.json"
        ]:
            assert (await ws.execute(command)).exit_code != 0
    finally:
        await ws.close()
    requests = await request_checks(os.environ["WANDB_BASE_URL"])
    print(
        json.dumps({
            "cases": results,
            "requests": requests
        },
                   ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
