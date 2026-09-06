import { readFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const [root, variant, resultFile, repeatArg = "3", nativeArg = ""] =
  process.argv.slice(2);
const base = root + "/typescript/packages/core";
const load = async (path: string) =>
  import(pathToFileURL(base + "/src/" + path).href);
const { Workspace } = await load("workspace/workspace.ts").catch(() =>
  load("workspace/workspace/workspace.ts"),
);
const { RAMResource } = await load("resource/ram/ram.ts");
const { RAMFileCacheStore } = await load("cache/file/ram.ts");
if (nativeArg === "--native") {
  const { nativeFingerprint } = await import(
    pathToFileURL(root + "/typescript/packages/node/src/cache/file/utils.ts")
      .href
  );
  const { registerFingerprintHasher } = await load("cache/file/utils.ts");
  registerFingerprintHasher(nativeFingerprint);
}
const { createShellParser } = await load("shell/parse/index.ts");
const require = createRequire(base + "/package.json");
const parser = await createShellParser({
  engineWasm: readFileSync(
    require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  ),
  grammarWasm: readFileSync(
    require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"),
  ),
});
const data = new TextEncoder().encode("line\n".repeat(4_000_000));
async function measure(run: () => Promise<void>) {
  let last = performance.now(),
    lag = 0,
    ticks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    lag = Math.max(lag, now - last - 5);
    last = now;
    ticks++;
  }, 5);
  const start = performance.now();
  try {
    await run();
  } finally {
    lag = Math.max(lag, performance.now() - last - 5);
    clearInterval(timer);
  }
  return {
    elapsedMs: performance.now() - start,
    maxLagMs: Math.max(0, lag),
    ticks,
  };
}
const commands = [
  "grep -c line /big",
  "wc -l /big",
  "cat /big | wc -l",
  "sort /big | uniq -c",
];
for (let round = 0; round < Number(repeatArg); round++) {
  for (const command of commands) {
    const ram = new RAMResource();
    ram.store.files.set("/big", data);
    const ws = new Workspace({ "/": ram }, { shellParser: parser });
    await ws.execute("echo warmup");
    const result = await measure(async () => {
      const io = await ws.execute(command);
      if (io.exitCode !== 0) throw Error(new TextDecoder().decode(io.stderr));
      const out = new TextDecoder().decode(io.stdout);
      if (!out.includes("4000000")) throw Error("wrong count " + out);
    });
    await ws.close();
    const record = { variant, round, workload: command, ...result };
    appendFileSync(resultFile, JSON.stringify(record) + "\n");
    console.log(record);
    await new Promise((r) => setTimeout(r, 50));
  }
  const cache = new RAMFileCacheStore({ limit: "128MB" });
  const result = await measure(async () => {
    await cache.set("/big", data);
  });
  const record = {
    variant,
    round,
    workload: "cache fingerprint 20MB",
    ...result,
  };
  appendFileSync(resultFile, JSON.stringify(record) + "\n");
  console.log(record);
  const small = new RAMResource();
  small.store.files.set(
    "/small",
    new TextEncoder().encode("line\n".repeat(100)),
  );
  const ws = new Workspace({ "/": small }, { shellParser: parser });
  await ws.execute("wc -l /small");
  const sm = await measure(async () => {
    for (let i = 0; i < 100; i++) await ws.execute("wc -l /small");
  });
  await ws.close();
  const row = { variant, round, workload: "100 small wc commands", ...sm };
  appendFileSync(resultFile, JSON.stringify(row) + "\n");
  console.log(row);
}
