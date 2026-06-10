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

import { createServer, type Server } from "node:http";
import {
  type FileStat,
  type IndexCacheStore,
  NOTION_COMMANDS,
  NOTION_PROMPT,
  NOTION_VFS_OPS,
  NOTION_WRITE_PROMPT,
  NotionAccessor,
  type NotionTransport,
  notionRead,
  notionReaddir,
  notionStat,
  PathSpec,
  RAMIndexCacheStore,
  type RegisteredCommand,
  type RegisteredOp,
  type Resource,
  ResourceName,
  resolveNotionGlob,
} from "@struktoai/mirage-core";
import { MountMode, Workspace } from "@struktoai/mirage-node";

const MOUNT = "/notion";
const PAGE_A = "aaaa1111-2222-3333-4444-555566667777";
const PAGE_B = "bbbb2222-3333-4444-5555-666677778888";
const PAGE_C = "cccc1111-2222-3333-4444-555566667777";
const BLOCK_NESTED = "dddd2222-3333-4444-5555-666677778888";
const DIR_A = `${MOUNT}/pages/Project_Roadmap__${PAGE_A}`;
const DIR_B = `${MOUNT}/pages/Notes__${PAGE_B}`;
const DIR_C = `${DIR_A}/Q1_Goals__${PAGE_C}`;

const DEC = new TextDecoder();

type Json = Record<string, unknown>;

function user(uid: string): Json {
  return { object: "user", id: uid };
}

function titleProp(title: string): Json {
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ type: "text", plain_text: title, text: { content: title } }],
    },
  };
}

function page(pageId: string, title: string, parent: Json): Json {
  return {
    object: "page",
    id: pageId,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-02T00:00:00.000Z",
    created_by: user("user-1"),
    last_edited_by: user("user-2"),
    parent,
    archived: false,
    url: `https://notion.example/${pageId.replaceAll("-", "")}`,
    properties: titleProp(title),
  };
}

function text(content: string, annotations: Json = {}): Json {
  return { type: "text", plain_text: content, annotations, text: { content } };
}

function block(blockId: string, btype: string, payload: Json, hasChildren = false): Json {
  return { object: "block", id: blockId, type: btype, has_children: hasChildren, [btype]: payload };
}

const PAGES: Record<string, Json> = {
  [PAGE_A]: page(PAGE_A, "Project Roadmap", { type: "workspace", workspace: true }),
  [PAGE_B]: page(PAGE_B, "Notes", { type: "workspace", workspace: true }),
  [PAGE_C]: page(PAGE_C, "Q1 Goals", { type: "page_id", page_id: PAGE_A }),
};

const BLOCKS: Record<string, Json[]> = {
  [PAGE_A]: [
    block("b-a1", "heading_1", { rich_text: [text("Roadmap")] }),
    block("b-a2", "paragraph", {
      rich_text: [text("Ship the "), text("beta", { bold: true }), text(" soon")],
    }),
    block(BLOCK_NESTED, "bulleted_list_item", { rich_text: [text("phase one")] }, true),
    block("b-a4", "code", { rich_text: [text("print(1)")], language: "python" }),
    block(PAGE_C, "child_page", { title: "Q1 Goals" }, true),
  ],
  [PAGE_B]: [
    block("b-b1", "paragraph", { rich_text: [text("alpha beta gamma")] }),
    block("b-b2", "to_do", { rich_text: [text("done item")], checked: true }),
  ],
  [PAGE_C]: [block("b-c1", "paragraph", { rich_text: [text("Q1 contents")] })],
  [BLOCK_NESTED]: [block("b-d1", "bulleted_list_item", { rich_text: [text("phase one detail")] })],
};

function startMockServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const parts = path.replace(/^\/+|\/+$/g, "").split("/");
    const sendJson = (payload: unknown): void => {
      const body = JSON.stringify(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    };
    if (req.method === "GET" && parts.length === 3 && parts[0] === "v1" && parts[1] === "pages") {
      const found = PAGES[parts[2] ?? ""];
      if (found !== undefined) {
        sendJson(found);
        return;
      }
    }
    if (
      req.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "v1" &&
      parts[1] === "blocks" &&
      parts[3] === "children"
    ) {
      sendJson({
        object: "list",
        results: BLOCKS[parts[2] ?? ""] ?? [],
        has_more: false,
        next_cursor: null,
      });
      return;
    }
    if (req.method === "POST" && parts.length === 2 && parts[0] === "v1" && parts[1] === "search") {
      sendJson({
        object: "list",
        results: Object.values(PAGES),
        has_more: false,
        next_cursor: null,
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({ server, port: address.port });
    });
  });
}

class RestNotionTransport implements NotionTransport {
  constructor(private readonly baseUrl: string) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    let url: string;
    let method = "GET";
    if (name === "API-post-search") {
      url = `${this.baseUrl}/search`;
      method = "POST";
    } else if (name === "API-retrieve-a-page") {
      url = `${this.baseUrl}/pages/${String(args.page_id)}`;
    } else if (name === "API-retrieve-block-children") {
      url = `${this.baseUrl}/blocks/${String(args.block_id)}/children`;
    } else {
      throw new Error(`unsupported tool: ${name}`);
    }
    const response = await fetch(url, { method });
    if (!response.ok) throw new Error(`mock notion: ${String(response.status)} for ${url}`);
    return (await response.json()) as Record<string, unknown>;
  }
}

class MockNotionResource implements Resource {
  readonly kind: string = ResourceName.NOTION;
  readonly isRemote: boolean = true;
  readonly indexTtl: number = 600;
  readonly prompt: string = NOTION_PROMPT;
  readonly writePrompt: string = NOTION_WRITE_PROMPT;
  readonly accessor: NotionAccessor;
  readonly index: IndexCacheStore;

  constructor(transport: NotionTransport) {
    this.accessor = new NotionAccessor(transport);
    this.index = new RAMIndexCacheStore({ ttl: this.indexTtl });
  }

  open(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  commands(): readonly RegisteredCommand[] {
    return NOTION_COMMANDS;
  }

  ops(): readonly RegisteredOp[] {
    return NOTION_VFS_OPS;
  }

  readFile(p: PathSpec): Promise<Uint8Array> {
    return notionRead(this.accessor, p, this.index);
  }

  readdir(p: PathSpec): Promise<string[]> {
    return notionReaddir(this.accessor, p, this.index);
  }

  stat(p: PathSpec): Promise<FileStat> {
    return notionStat(this.accessor, p, this.index);
  }

  async fingerprint(p: PathSpec): Promise<string | null> {
    const lookup = await this.index.get(p.original);
    return lookup.entry?.remoteTime ?? null;
  }

  glob(paths: readonly PathSpec[], prefix = ""): Promise<PathSpec[]> {
    const effective =
      prefix !== ""
        ? paths.map((p) =>
            p.prefix !== ""
              ? p
              : new PathSpec({
                  original: p.original,
                  directory: p.directory,
                  ...(p.pattern !== null ? { pattern: p.pattern } : {}),
                  resolved: p.resolved,
                  prefix,
                }),
          )
        : paths;
    return resolveNotionGlob(this.accessor, effective, this.index);
  }

  getState(): Promise<{ type: string }> {
    return Promise.resolve({ type: this.kind });
  }

  loadState(): Promise<void> {
    return Promise.resolve();
  }
}

const CASES: ReadonlyArray<readonly [string, string]> = [
  ["ls_root", `ls ${MOUNT}/`],
  ["ls_pages", `ls ${MOUNT}/pages/`],
  ["ls_page_a", `ls ${DIR_A}/`],
  ["tree", `tree -L 2 ${MOUNT}/`],
  ["cat_page_a", `cat ${DIR_A}/page.json`],
  ["cat_child", `cat ${DIR_C}/page.json`],
  ["jq_title", `jq ".title" ${DIR_A}/page.json`],
  ["jq_markdown", `jq ".markdown" ${DIR_B}/page.json`],
  ["head_4", `head -n 4 ${DIR_A}/page.json`],
  ["wc_l_two", `wc -l ${DIR_A}/page.json ${DIR_B}/page.json`],
  ["stat_page_json", `stat ${DIR_A}/page.json`],
  ["find_json", `find ${MOUNT}/pages/ -name page.json`],
  ["pipe_grep", `cat ${DIR_B}/page.json | grep -c alpha`],
];

async function run(ws: Workspace, name: string, cmd: string): Promise<void> {
  const result = await ws.execute(cmd);
  const out = DEC.decode(result.stdout);
  process.stdout.write(`=== ${name} ===\n`);
  process.stdout.write(out.endsWith("\n") ? out : out + "\n");
}

async function main(): Promise<void> {
  const { server, port } = await startMockServer();
  const resource = new MockNotionResource(new RestNotionTransport(`http://127.0.0.1:${String(port)}/v1`));
  const ws = new Workspace({ [MOUNT]: resource }, { mode: MountMode.READ });
  try {
    for (const [name, cmd] of CASES) {
      await run(ws, name, cmd);
    }
  } finally {
    await ws.close();
    server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
