import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { md5HexAsync } from "../../typescript/packages/core/src/utils/hash.ts";
import { Checkpoint } from "../../typescript/packages/core/src/io/cooperative.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function incremental(data: Uint8Array, size: number) {
  const hash = createHash("md5");
  const checkpoint = new Checkpoint();
  for (let offset = 0; offset < data.length; offset += size) {
    hash.update(data.subarray(offset, offset + size));
    const pending = checkpoint.run();
    if (pending) await pending;
  }
  return hash.digest("hex");
}
const variants = [
  [
    "native-one-shot",
    (d: Uint8Array) => createHash("md5").update(d).digest("hex"),
  ],
  ["native-16KiB-yield", (d: Uint8Array) => incremental(d, 16 * 1024)],
  ["native-64KiB-yield", (d: Uint8Array) => incremental(d, 64 * 1024)],
  ["native-1MiB-yield", (d: Uint8Array) => incremental(d, 1024 * 1024)],
  ["js-incremental", md5HexAsync],
] as const;
const rows: any[] = [];
for (const bytes of [20_000_000, 100_000_000]) {
  const data = new Uint8Array(bytes).fill(97);
  const expected = createHash("md5").update(data).digest("hex");
  for (const [, fn] of variants) await fn(data.subarray(0, 1_000_000));
  for (let round = 0; round < 5; round++)
    for (let j = 0; j < variants.length; j++) {
      const [variant, fn] = variants[(j + round) % variants.length];
      await sleep(15);
      let previous = performance.now(),
        lag = 0,
        ticks = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        lag = Math.max(lag, now - previous - 5);
        previous = now;
        ticks++;
      }, 5);
      const start = performance.now();
      const digest = await fn(data);
      const elapsed = performance.now() - start;
      await sleep(7);
      clearInterval(timer);
      if (digest !== expected) throw new Error("digest mismatch");
      const row = {
        bytes,
        round,
        variant,
        elapsedMs: elapsed,
        maxLagMs: lag,
        ticks,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
}
writeFileSync(
  process.argv[2] ?? "/tmp/hash-native-results.json",
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      rows,
    },
    null,
    2,
  ),
);
for (const bytes of [20_000_000, 100_000_000])
  for (const [variant] of variants) {
    const a = rows.filter((r) => r.bytes === bytes && r.variant === variant);
    const median = (key: string) =>
      a.map((r) => r[key]).sort((a, b) => a - b)[2];
    console.log(
      JSON.stringify({
        bytes,
        variant,
        medianMs: median("elapsedMs"),
        medianMaxLagMs: median("maxLagMs"),
      }),
    );
  }
