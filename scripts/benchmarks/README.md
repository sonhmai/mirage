# Cooperative builtin benchmark

Issue: https://github.com/strukto-ai/mirage/issues/1002

Measured locally on macOS arm64, Node 24, 2026-09-06. Baseline is main commit
`67389cca5`, not a release tag. Three serial runs per variant; table reports median
runtime / median maximum event-loop lag in milliseconds. The probe uses a 5 ms
interval. These are observations, not deadline guarantees; GC, JIT and host load
can change them. No other test suite ran during each benchmark batch.

The issue author's downstream patch was inaccessible. **Proposal reconstruction**
is our interpretation of the issue: 20 ms yields at iterator/drain/materialization
boundaries, 1 MiB `wc` slices with a byte-only line-count path, and one-shot native
MD5. It is not the author's actual implementation. The exact reconstruction is
saved in `issue-1002-reconstruction.patch`; do not use these measurements to claim
superiority over their uninspected patch.

Input: one RAM file containing 4,000,000 `line\n` records (20,000,000 bytes).
Each command uses a fresh workspace and parser warmup. All outputs are checked.
The fingerprint case separately populates a RAM file cache; it is not part of the
command throughput measurement. The branch explicitly registers its Node native
fingerprint implementation with the source-loaded core used by this harness.

| Workload                           | Main baseline | Proposal reconstruction | Branch with native incremental hashing |
| ---------------------------------- | ------------: | ----------------------: | -------------------------------------: |
| `grep -c line /big`                |   1130 / 1125 |               1415 / 35 |                              1995 / 12 |
| `wc -l /big`                       |     663 / 658 |                 73 / 41 |                                 38 / 6 |
| `cat /big \| wc -l`                |     665 / 660 |                 57 / 41 |                                 49 / 6 |
| `sort /big \| uniq -c`             |   2910 / 2905 |             2938 / 2933 |                            3241 / 1087 |
| Cache fingerprint, 20 MB           |     318 / 313 |                 32 / 27 |                                 36 / 7 |
| 100 sequential small `wc` commands |       21 / 16 |                 20 / 15 |                                19 / 14 |

The branch favors responsiveness, but does not win every workload: grep is about
41% slower than the reconstruction, and native sort still blocks for over a second.
Replacing sort, adding workers, or redesigning regex execution is outside this draft.

Separate hashing benchmark: five interleaved rounds, identical data and verified
MD5 digests. Native 64 KiB updates with a 10 ms yield budget take 34 ms / 6 ms lag
at 20 MB, and 163 ms / 6 ms at 100 MB. One-shot native takes 30 / 25 and 147 / 142;
JavaScript incremental takes 355 / 7 and 1758 / 7. Raw observations are in
`hash-results.csv` and `cooperative-results.csv`.

## Reproduce

Use the repository's installed dependencies and Node 24. From the repository root:

```sh
fnm exec --using 24 node --experimental-transform-types scripts/benchmarks/cooperative.mts "$PWD" branch /tmp/branch-results.jsonl 3 --native
fnm exec --using 24 node --experimental-transform-types scripts/benchmarks/hash.mts /tmp/hash-results.json
```

The command harness arguments are source root, variant label, append-only JSONL
output, repetitions, and optional `--native`. Without `--native`, it uses that
source tree's default hasher. For baseline/reconstruction, export
`typescript/packages/core` from commit `67389cca5` into separate temporary trees,
link each core directory's `node_modules` to the installed core dependencies, and
apply `issue-1002-reconstruction.patch` with `git apply --unidiff-zero` only to the reconstruction tree. Pass each
export's root to the same harness, omitting `--native`. No checkout or worktree
switch is required.
