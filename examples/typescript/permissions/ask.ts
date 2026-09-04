// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

import {
  MountMode,
  Outcome,
  RAMResource,
  Scope,
  Workspace,
  parseSessionProfile,
} from "@struktoai/mirage-node";
import type { AskHandler, Decision } from "@struktoai/mirage-node";

// An ask, end to end: the rule that asks, the two ways a host answers
// it, and what each answer does to the line that asked and to the next
// one.
//
// One mount, one role, one rule: deletes are reviewed. The same line is
// run under two hosts.
//
//   inline        the workspace is built with `onAsk`, so the question
//                 is put to the host while the line waits, the way a
//                 tool-approval prompt works. The host here is a script
//                 holding a queue of answers, standing in for a person.
//   out of band   no `onAsk`: the line is refused for now with a
//                 `pending` record naming the ask id, the question waits
//                 in `ws.decisions`, and the host answers it later by
//                 id. The agent's retry then passes, or is refused from
//                 the record.
//
// What the table pins, and the example's reason to exist:
//
//   allow once    passes exactly the line it was given for. The next
//                 identical line is a new question, whichever way the
//                 answer arrived.
//   deny          refuses the line, and the agent's immediate retry is
//                 refused from the record without the human being asked
//                 again. The retry spends the record, so the run after
//                 it is a question once more.
//   allow for     passes every line the rule covers for the rest of the
//   the session   session; nothing asks again.

const ROLE = parseSessionProfile(
  {
    commands: {
      allow: ["ls", "cat", "echo", "rm"],
      ask: [{ reason: "deletes are reviewed", commands: ["rm"] }],
    },
  },
  "profile `agent`",
);

const SESSION = "agent";

/** A person with a queue of answers: the host `onAsk` hands each question to. */
class Reviewer {
  readonly answers: [Outcome, Scope][];
  count = 0;
  /** How the last line was answered, or null when it raised no question. */
  said: string | null = null;

  constructor(answers: [Outcome, Scope][]) {
    this.answers = [...answers];
  }

  readonly onAsk: AskHandler = (record: Decision): Promise<Decision> => {
    const next = this.answers.shift();
    if (next === undefined)
      throw new Error(`no answer scripted for ${record.command}`);
    const [outcome, scope] = next;
    this.count += 1;
    this.said = `asked #${String(this.count)}, ${verdict(outcome, scope)}`;
    return Promise.resolve({ ...record, outcome, scope });
  };
}

function verdict(outcome: Outcome, scope: Scope): string {
  if (outcome === Outcome.DENY) return "refused";
  return scope === Scope.SESSION ? "allowed for the session" : "allowed once";
}

const dec = new TextDecoder();

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** One row of the table: the line, how it was decided, and what came back. */
function row(
  line: string,
  how: string,
  code: number,
  out: string,
  note: string,
): void {
  const first = out.split("\n")[0] ?? "";
  console.log(
    `${pad(line, 16)} ${pad(how, 34)} [${String(code)}] ${first}`.trimEnd(),
  );
  console.log(`${pad("", 16)} ${pad("", 34)} ${note}`);
}

async function run(
  ws: Workspace,
  line: string,
): Promise<[number, string, string]> {
  const res = await ws.execute(line, { sessionId: SESSION });
  const out = res.stdout === null ? "" : dec.decode(res.stdout);
  const err = res.stderr === null ? "" : dec.decode(res.stderr);
  const how =
    res.refusal === null
      ? "-"
      : res.refusal.kind === "pending"
        ? `pending ${res.refusal.askId ?? ""}`
        : `refused: ${res.refusal.reason}`;
  return [res.exitCode, err !== "" ? err : out, how];
}

async function seed(ws: Workspace): Promise<void> {
  for (const name of ["a", "b", "c"])
    await ws.fs.writeFile(`/data/${name}.txt`, `${name}\n`);
}

function world(onAsk?: AskHandler): Workspace {
  const ws = new Workspace(
    { "/data/": new RAMResource() },
    {
      mode: MountMode.WRITE,
      profiles: { agent: ROLE },
      ...(onAsk === undefined ? {} : { onAsk }),
    },
  );
  ws.createSession(SESSION, { profile: "agent" });
  return ws;
}

async function inline(): Promise<void> {
  console.log("=== inline: the host answers while the line waits ===");
  const reviewer = new Reviewer([
    [Outcome.ALLOW, Scope.ONCE],
    [Outcome.DENY, Scope.ONCE],
    [Outcome.ALLOW, Scope.SESSION],
  ]);
  const ws = world(reviewer.onAsk);
  try {
    const script: [string, string][] = [
      ["rm /data/a.txt", "a nod covers the line that asked, which ran"],
      [
        "rm /data/a.txt",
        "and only that line: the same words are a new question",
      ],
      [
        "rm /data/a.txt",
        "the refusal stands for the retry, and is spent by it",
      ],
      ["rm /data/a.txt", "so the run after the retry is a question again"],
      ["rm /data/b.txt", "a session grant covers every line the rule does"],
    ];
    for (const [line, note] of script) {
      await seed(ws);
      reviewer.said = null;
      const [code, out] = await run(ws, line);
      row(line, reviewer.said ?? "not asked", code, out, note);
    }
  } finally {
    await ws.close();
  }
}

async function outOfBand(): Promise<void> {
  console.log("=== out of band: the question waits in the ledger ===");
  const ws = world();
  try {
    await seed(ws);
    const refused = await run(ws, "rm /data/a.txt");
    row(
      "rm /data/a.txt",
      refused[2],
      refused[0],
      refused[1],
      "nobody answers inline: refused for now, and the ask recorded",
    );

    // The host reads the ledger and answers by id. The id is a digest of
    // the session, cwd and words, so a retry of the line quotes the same one.
    let [waiting] = ws.decisions.pending(SESSION);
    if (waiting === undefined) throw new Error("nothing pending");
    console.log(`host: allow ${waiting.id} once`);
    await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.ONCE);
    let retry = await run(ws, "rm /data/a.txt");
    row(
      "rm /data/a.txt",
      retry[2],
      retry[0],
      retry[1],
      "the retry consumed the grant; the ledger is empty again",
    );

    const asked = await run(ws, "rm /data/b.txt");
    row(
      "rm /data/b.txt",
      asked[2],
      asked[0],
      asked[1],
      "a different line is its own question",
    );
    [waiting] = ws.decisions.pending(SESSION);
    if (waiting === undefined) throw new Error("nothing pending");
    console.log(`host: deny ${waiting.id} "not today"`);
    await ws.decisions.answer(
      waiting.id,
      Outcome.DENY,
      Scope.ONCE,
      "not today",
    );
    retry = await run(ws, "rm /data/b.txt");
    row(
      "rm /data/b.txt",
      retry[2],
      retry[0],
      retry[1],
      "refused from the record, which that refusal spends",
    );
    const again = await run(ws, "rm /data/b.txt");
    row(
      "rm /data/b.txt",
      again[2],
      again[0],
      again[1],
      "so the line after it asks afresh, under the same id",
    );
    [waiting] = ws.decisions.pending(SESSION);
    if (waiting === undefined) throw new Error("nothing pending");
    console.log(`host: allow ${waiting.id} for the session`);
    await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.SESSION);
    retry = await run(ws, "rm /data/b.txt");
    row("rm /data/b.txt", retry[2], retry[0], retry[1], "the retry passes");
    const covered = await run(ws, "rm /data/c.txt");
    row(
      "rm /data/c.txt",
      covered[2],
      covered[0],
      covered[1],
      "and so does every other line the rule covers",
    );
    console.log(
      `ledger: ${String(ws.decisions.list(SESSION).length)} record(s) standing, ${String(ws.decisions.pending(SESSION).length)} pending`,
    );
  } finally {
    await ws.close();
  }
}

async function main(): Promise<void> {
  await inline();
  await outOfBand();
}

await main();
