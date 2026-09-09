import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from mirage import MountMode, Workspace
from mirage.resource.wandb import WandbConfig, WandbResource


async def request_checks(base: str) -> list[dict[str, Any]]:
    results = []
    scenarios = json.loads(Path(__file__).with_suffix('.json').read_text())
    for scenario in scenarios:
        resource = WandbResource(
            WandbConfig(entities=['lab'],
                        api_key=os.environ["WANDB_API_KEY"],
                        base_url=base))
        ws = Workspace({'/wandb': resource}, mode=MountMode.READ)
        requests: list[dict[str, Any]] = []
        request = resource.accessor.client.request

        async def recording(query: str,
                            variables: Mapping[str, Any]) -> dict[str, Any]:
            requests.append({'query': query, 'variables': dict(variables)})
            return await request(query, variables)

        resource.accessor.client.request = recording
        try:
            for step in scenario['steps']:
                if step.get('invalidate'):
                    await resource.index.invalidate()
                start = len(requests)
                result = await ws.execute(step['command'])
                results.append({
                    'exit_code': result.exit_code,
                    'requests': requests[start:]
                })
        finally:
            await ws.close()
    return results
