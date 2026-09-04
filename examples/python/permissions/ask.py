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
from collections.abc import AsyncIterator

from mirage import Decision, MountMode, Outcome, Scope, Workspace
from mirage.resource.ram import RAMResource

# An ask, end to end: the rule that asks, the two ways a host answers
# it, and what each answer does to the line that asked and to the next
# one.
#
# One mount, one role, one rule: deletes are reviewed. The same line is
# run under two hosts.
#
#   inline        the workspace is built with ``on_ask``, so the
#                 question is put to the host while the line waits, the
#                 way a tool-approval prompt works. The host here is a
#                 script holding a queue of answers, standing in for a
#                 person.
#   out of band   no ``on_ask``: the line is refused for now with a
#                 ``pending`` record naming the ask id, the question
#                 waits in ``ws.decisions``, and the host answers it
#                 later by id. The agent's retry then passes, or is
#                 refused from the record.
#
# What the table pins, and the example's reason to exist:
#
#   allow once    passes exactly the line it was given for. The next
#                 identical line is a new question, whichever way the
#                 answer arrived.
#   deny          refuses the line, and the agent's immediate retry is
#                 refused from the record without the human being asked
#                 again. The retry spends the record, so the run after
#                 it is a question once more.
#   allow for     passes every line the rule covers for the rest of the
#   the session   session; nothing asks again.

ROLE = {
    "commands": {
        "allow": ["ls", "cat", "echo", "rm"],
        "ask": [{
            "reason": "deletes are reviewed",
            "commands": ["rm"]
        }],
    },
}

SESSION = "agent"


class Reviewer:
    """A person with a queue of answers: the host ``on_ask`` hands each
    question to.

    Args:
        answers (list[tuple[Outcome, Scope]]): the answers, in the order
            the questions will come.
    """

    def __init__(self, answers: list[tuple[Outcome, Scope]]) -> None:
        self.answers = list(answers)
        self.count = 0
        # How the last line was answered, or None when it raised no
        # question.
        self.said: str | None = None

    async def __call__(self, record: Decision) -> Decision:
        if not self.answers:
            raise RuntimeError(f"no answer scripted for {record.command}")
        outcome, scope = self.answers.pop(0)
        self.count += 1
        self.said = f"asked #{self.count}, {verdict(outcome, scope)}"
        return dataclasses.replace(record, outcome=outcome, scope=scope)


def verdict(outcome: Outcome, scope: Scope) -> str:
    if outcome is Outcome.DENY:
        return "refused"
    return ("allowed for the session"
            if scope is Scope.SESSION else "allowed once")


def row(line: str, how: str, code: int, out: str, note: str) -> None:
    """One row of the table: the line, how it was decided, and what came
    back.

    Args:
        line (str): the line the agent typed.
        how (str): how the ledger or the host decided it.
        code (int): the exit code.
        out (str): stderr when there was any, else stdout.
        note (str): what the row shows.
    """
    first = out.split("\n")[0] if out else ""
    print(f"{line:16} {how:34} [{code}] {first}".rstrip())
    print(f"{'':16} {'':34} {note}")


def text(raw: bytes | AsyncIterator[bytes] | None) -> str:
    """A drained stream as text; a line run to completion holds bytes."""
    return raw.decode() if isinstance(raw, bytes) else ""


async def run(ws: Workspace, line: str) -> tuple[int, str, str]:
    res = await ws.execute(line, session_id=SESSION)
    out = text(res.stdout)
    err = text(res.stderr)
    if res.refusal is None:
        how = "-"
    elif res.refusal.kind == "pending":
        how = f"pending {res.refusal.ask_id or ''}"
    else:
        how = f"refused: {res.refusal.reason}"
    return res.exit_code, err if err else out, how


async def seed(ws: Workspace) -> None:
    for name in ("a", "b", "c"):
        await ws.fs.write(f"/data/{name}.txt", f"{name}\n".encode())


def world(on_ask: Reviewer | None = None) -> Workspace:
    ws = Workspace({"/data/": RAMResource()},
                   mode=MountMode.WRITE,
                   profiles={"agent": ROLE},
                   on_ask=on_ask)
    ws.create_session(SESSION, profile="agent")
    return ws


async def inline() -> None:
    print("=== inline: the host answers while the line waits ===")
    reviewer = Reviewer([
        (Outcome.ALLOW, Scope.ONCE),
        (Outcome.DENY, Scope.ONCE),
        (Outcome.ALLOW, Scope.SESSION),
    ])
    ws = world(reviewer)
    try:
        script = [
            ("rm /data/a.txt", "a nod covers the line that asked, which ran"),
            ("rm /data/a.txt",
             "and only that line: the same words are a new question"),
            ("rm /data/a.txt",
             "the refusal stands for the retry, and is spent by it"),
            ("rm /data/a.txt",
             "so the run after the retry is a question again"),
            ("rm /data/b.txt",
             "a session grant covers every line the rule does"),
        ]
        for line, note in script:
            await seed(ws)
            reviewer.said = None
            code, out, _how = await run(ws, line)
            row(line, reviewer.said or "not asked", code, out, note)
    finally:
        await ws.close()


async def out_of_band() -> None:
    print("=== out of band: the question waits in the ledger ===")
    ws = world()
    try:
        await seed(ws)
        code, out, how = await run(ws, "rm /data/a.txt")
        row("rm /data/a.txt", how, code, out,
            "nobody answers inline: refused for now, and the ask recorded")

        # The host reads the ledger and answers by id. The id is a digest
        # of the session, cwd and words, so a retry of the line quotes the
        # same one.
        waiting, = ws.decisions.pending(SESSION)
        print(f"host: allow {waiting.id} once")
        await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.ONCE)
        code, out, how = await run(ws, "rm /data/a.txt")
        row("rm /data/a.txt", how, code, out,
            "the retry consumed the grant; the ledger is empty again")

        code, out, how = await run(ws, "rm /data/b.txt")
        row("rm /data/b.txt", how, code, out,
            "a different line is its own question")
        waiting, = ws.decisions.pending(SESSION)
        print(f'host: deny {waiting.id} "not today"')
        await ws.decisions.answer(waiting.id, Outcome.DENY, Scope.ONCE,
                                  "not today")
        code, out, how = await run(ws, "rm /data/b.txt")
        row("rm /data/b.txt", how, code, out,
            "refused from the record, which that refusal spends")
        code, out, how = await run(ws, "rm /data/b.txt")
        row("rm /data/b.txt", how, code, out,
            "so the line after it asks afresh, under the same id")

        waiting, = ws.decisions.pending(SESSION)
        print(f"host: allow {waiting.id} for the session")
        await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.SESSION)
        code, out, how = await run(ws, "rm /data/b.txt")
        row("rm /data/b.txt", how, code, out, "the retry passes")
        code, out, how = await run(ws, "rm /data/c.txt")
        row("rm /data/c.txt", how, code, out,
            "and so does every other line the rule covers")
        print(f"ledger: {len(ws.decisions.list(SESSION))} record(s) standing, "
              f"{len(ws.decisions.pending(SESSION))} pending")
    finally:
        await ws.close()


async def main() -> None:
    await inline()
    await out_of_band()


if __name__ == "__main__":
    asyncio.run(main())
