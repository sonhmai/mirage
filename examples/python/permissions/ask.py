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
import dataclasses

from mirage import Decision, MountMode, Outcome, Scope, Workspace
from mirage.policy import AskHandler
from mirage.resource.ram import RAMResource

# One profile, one rule. `allow` is what the session may run at all;
# `ask` puts one of those commands to a person before it runs.
ROLE = {
    "commands": {
        "allow": ["ls", "rm"],
        "ask": [{
            "reason": "deletes are reviewed",
            "commands": ["rm"]
        }],
    },
}


async def reviewer(record: Decision) -> Decision:
    """The host answering inline: the ledger awaits this while the line
    waits, the way a tool-approval prompt works. ALLOW at ONCE passes
    this line only; SESSION would pass every rm for the rest of the
    session.

    Args:
        record (Decision): the question, with no outcome yet.
    """
    print(f"approve? {record.command} {' '.join(record.argv)}")
    return dataclasses.replace(record, outcome=Outcome.ALLOW, scope=Scope.ONCE)


def world(on_ask: AskHandler | None = None) -> Workspace:
    ws = Workspace({"/data/": RAMResource()},
                   mode=MountMode.WRITE,
                   profiles={"agent": ROLE},
                   on_ask=on_ask)
    ws.create_session("agent", profile="agent")
    return ws


async def run(ws: Workspace, line: str) -> None:
    await ws.fs.write("/data/a.txt", b"a\n")
    res = await ws.execute(line, session_id="agent")
    how = "ran" if res.refusal is None else f"refused ({res.refusal.kind})"
    print(f"{line}: {how}, exit {res.exit_code}")


async def inline() -> None:
    print("=== inline: the reviewer answers while the line waits ===")
    ws = world(reviewer)
    try:
        await run(ws, "rm /data/a.txt")
        # Once means once: the same line asks again.
        await run(ws, "rm /data/a.txt")
    finally:
        await ws.close()


async def out_of_band() -> None:
    print("=== out of band: the question waits in the ledger ===")
    ws = world()
    try:
        # Nobody answers inline, so the line is refused for now and the
        # question is recorded under an id the agent is told to quote.
        await run(ws, "rm /data/a.txt")
        waiting, = ws.decisions.pending("agent")
        print(f"host: allow {waiting.id} for the session")
        await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.SESSION)
        await run(ws, "rm /data/a.txt")
        # A session grant covers every line the rule does, unasked.
        await run(ws, "rm /data/a.txt")
    finally:
        await ws.close()


async def main() -> None:
    await inline()
    await out_of_band()


if __name__ == "__main__":
    asyncio.run(main())
