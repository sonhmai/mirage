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

// One profile, one rule. `allow` is what the session may run at all;
// `ask` puts one of those commands to a person before it runs.
const ROLE = parseSessionProfile(
  {
    commands: {
      allow: ["ls", "rm"],
      ask: [{ reason: "deletes are reviewed", commands: ["rm"] }],
    },
  },
  "profile `agent`",
);

/**
 * The host answering inline: the ledger awaits this while the line
 * waits, the way a tool-approval prompt works. ALLOW at ONCE passes this
 * line only; SESSION would pass every rm for the rest of the session.
 */
const reviewer: AskHandler = (record: Decision): Promise<Decision> => {
  console.log(`approve? ${record.command} ${record.argv.join(" ")}`);
  return Promise.resolve({ ...record, outcome: Outcome.ALLOW, scope: Scope.ONCE });
};

function world(onAsk?: AskHandler): Workspace {
  const ws = new Workspace(
    { "/data/": new RAMResource() },
    {
      mode: MountMode.WRITE,
      profiles: { agent: ROLE },
      ...(onAsk === undefined ? {} : { onAsk }),
    },
  );
  ws.createSession("agent", { profile: "agent" });
  return ws;
}

async function run(ws: Workspace, line: string): Promise<void> {
  await ws.fs.writeFile("/data/a.txt", "a\n");
  const res = await ws.execute(line, { sessionId: "agent" });
  const how = res.refusal === null ? "ran" : `refused (${res.refusal.kind})`;
  console.log(`${line}: ${how}, exit ${String(res.exitCode)}`);
}

async function inline(): Promise<void> {
  console.log("=== inline: the reviewer answers while the line waits ===");
  const ws = world(reviewer);
  try {
    await run(ws, "rm /data/a.txt");
    // Once means once: the same line asks again.
    await run(ws, "rm /data/a.txt");
  } finally {
    await ws.close();
  }
}

async function outOfBand(): Promise<void> {
  console.log("=== out of band: the question waits in the ledger ===");
  const ws = world();
  try {
    // Nobody answers inline, so the line is refused for now and the
    // question is recorded under an id the agent is told to quote.
    await run(ws, "rm /data/a.txt");
    const [waiting] = ws.decisions.pending("agent");
    if (waiting === undefined) throw new Error("no question recorded");
    console.log(`host: allow ${waiting.id} for the session`);
    await ws.decisions.answer(waiting.id, Outcome.ALLOW, Scope.SESSION);
    await run(ws, "rm /data/a.txt");
    // A session grant covers every line the rule does, unasked.
    await run(ws, "rm /data/a.txt");
  } finally {
    await ws.close();
  }
}

async function main(): Promise<void> {
  await inline();
  await outOfBand();
}

await main();
