# Proposal: a narrow Rust kernel for version identity

- Status: proposal for maintainer review
- Related roadmap: `strukto-ai/mirage#721`, Phase 2a
- Prototype: `experiments/rust-pointer-codec/`

## Decision requested

Approve Rust as a small internal correctness kernel for version-pointer encoding and
validation, subject to the packaging gates below.

This does **not** propose rewriting Mirage, moving resource I/O into Rust, or making
Rust a third public implementation. Python and TypeScript remain the product surfaces
and own workspace behavior. Rust owns only deterministic bytes at a persistence
boundary where the roadmap already requires both hosts to be byte-identical.

## Why

### The roadmap creates a cross-language identity contract

Phase 2a requires Python and TypeScript to emit byte-identical LFS and remote pointers:

```json
{"kind":"lfs","oid":"sha256:...","size":1048576}
```

```json
{"etag":null,"kind":"remote","path":"/data/a.csv","size":42,"version_id":"v17"}
```

These bytes become version-tree entries. A difference in key ordering, optional-field
handling, integer representation, UTF-8 encoding, or validation changes persistent
identity and can make the same workspace produce different commits in the two hosts.
That is a correctness failure, not a cosmetic parity gap.

Mirage normally benefits from mirrored Python and TypeScript implementations. This
boundary is different: there should be one authority because its output is an identity.

### This is a good FFI boundary

The proposed kernel is:

- pure and synchronous;
- deterministic for the same input;
- independent of resources, mounts, sessions, commands, and network I/O;
- small enough to fuzz and exhaustively vector-test;
- called at two already-async internal seams, not across hot command-dispatch paths.

That shape avoids the usual FFI problems: object ownership, callbacks, cancellation,
async runtimes, and chatty per-operation crossings.

### Rust is for one authority, not primarily speed

The main benefit is removing two serializers and two validators from a persistent wire
contract. Rust also gives the boundary one type model, one UTF-8/JSON implementation,
one SHA-256 implementation, and one fuzz target. Performance may improve later for
content hashing, but it is not the reason to adopt Rust here.

## What

### In scope

A production Rust workspace with three crates:

```text
rust/
├── Cargo.toml
└── crates/
    ├── version-pointer-core/   pure model, validation, canonical bytes
    ├── version-pointer-py/     PyO3 adapter
    └── version-pointer-wasm/   wasm-bindgen adapter
```

The core contract should cover:

- `lfs` and `remote` tagged pointer models;
- compact UTF-8 JSON with lexicographically sorted object keys;
- explicit rules for optional fields;
- validation of LFS oid syntax and remote backend identity;
- strict decode plus canonical re-encoding;
- shared golden vectors and property/fuzz tests.

The adapters should expose only coarse operations:

- encode an LFS pointer;
- encode a remote pointer;
- decode and canonicalize stored pointer bytes;
- classify validation failures into stable host errors.

The current spike also hashes canonical pointer bytes to prove cross-binding identity.
That hash is **not** the LFS `oid`. The LFS `oid` is SHA-256 of file content. Production
naming must keep those concepts distinct, and the existing version store may already
make a separate pointer-hash API unnecessary.

### Integration seams

Python remains async-native and calls a private wrapper from:

- `python/mirage/server/version/state_tree.py` for tree inputs;
- `python/mirage/server/version/api.py` for snapshot and version reads.

TypeScript keeps WASM loading private to `@struktoai/mirage-server` and calls it from:

- `typescript/packages/server/src/version/stateTree.ts` for tree inputs;
- `typescript/packages/server/src/version/api.ts` for snapshot and version reads.

The WASM module should not move into `@struktoai/mirage-core` unless browser versioning
actually needs it. That avoids imposing async initialization and bundle weight on
unrelated core consumers.

### Explicit non-goals

- no VFS, mount, resource, accessor, command, shell, FUSE, or policy code in Rust;
- no backend reads or writes in Rust;
- no Rust async runtime;
- no public Python or TypeScript API change;
- no long-lived fallback serializer after the production contract ships;
- no broader migration justified only by the existence of this workspace.

## How

### Phase 0: settle the wire contract

Before production integration, maintainers decide and freeze:

1. whether absent `etag` and `version_id` encode as `null` or are omitted;
1. whether a remote pointer must contain at least one of those identity tokens;
1. whether unknown fields fail closed or require an explicit schema-version strategy;
1. whether pointer objects need a version field before any release persists them;
1. the exact error categories visible to Python and TypeScript;
1. the 1 MiB threshold boundary and content-oid vectors for LFS objects.

The result is one checked-in fixture corpus consumed by Rust, Python, and TypeScript.

### Phase 1: productionize the build, without behavior changes

- move the experiment into a top-level Rust workspace;
- pin Rust, `wasm-bindgen-cli`, and `maturin` versions in CI;
- build Python ABI3 wheels for the supported platform matrix;
- generate and bundle one WASM artifact plus TypeScript declarations;
- add license, dependency, vulnerability, reproducibility, and artifact-size checks;
- document the contributor path for rebuilding generated artifacts;
- keep all adapters dormant so this phase changes no stored data.

This phase is the adoption gate. If release complexity is unacceptable, stop here and
use mirrored host implementations with the same fixture corpus instead.

### Phase 2: integrate both hosts at the two seams

- replace only pointer serialization and validation in the tree builder;
- decode pointers through the same kernel in the version reader;
- keep object-store reads, writes, and content streaming in the host implementations;
- land Python and TypeScript integration together, because parity is an acceptance
  condition of Phase 2a rather than follow-up work;
- run cross-host fixtures against the same file bytes and backend metadata.

Before the first release that persists pointers, dual-run host reference code in tests
and assert exact byte equality. Delete the reference path before shipping. Once released,
the stored pointer schema becomes a compatibility contract and its decoder must remain.

### Phase 3: prove operability

CI and release proof should cover:

- Python 3.11+ wheel import on every supported OS and architecture;
- Node 22 and browser WASM initialization;
- deterministic bytes under additive Cargo features such as
  `serde_json/preserve_order`;
- invalid UTF-8, unknown fields, malformed JSON, integer bounds, and invalid oids;
- arbitrary valid pointer round trips through fuzz/property tests;
- identical Python and TypeScript output for the shared fixture corpus;
- cold build time, installed package size, WASM gzip size, and runtime initialization;
- source-distribution behavior when a user has no Rust toolchain.

## Binding choice

### Python: PyO3 ABI3

Recommendation: use PyO3 with `abi3-py311`. Mirage supports Python 3.11+, so one wheel
per OS/architecture avoids a wheel per Python minor version. Publish wheels before any
release depends on the extension; do not make ordinary users compile Rust.

### TypeScript: WASM first

Recommendation: use `wasm-bindgen` rather than Node-API for this kernel.

- one artifact serves Node and a future browser consumer;
- no native Node binary matrix;
- the current versioning seams can absorb one-time async initialization;
- the spike's raw boundary is synchronous after initialization.

Costs are explicit: the spike produced 177,424 bytes of release WASM, 71,175 bytes
gzip before `wasm-opt`, plus 9,512 bytes of JavaScript glue. Rust `u64` crosses as
JavaScript `BigInt`, so wrappers must convert internally and keep it out of public APIs.

Reconsider Node-API only if measured initialization or WASM execution cost is material
in the server package. Do not ship both binding strategies without that evidence.

## Risks and mitigations

### Packaging becomes part of correctness

Risk: unavailable wheels, mismatched `wasm-bindgen` versions, or stale generated WASM
can break an otherwise correct implementation.

Mitigation: artifact builds are release gates; generated bindings record the producing
tool version; CI imports the built wheel and generated WASM rather than testing only
the Rust crate.

### The kernel can grow into an accidental rewrite

Risk: nearby version-store, CAS, or resource logic moves across the boundary because a
Rust workspace now exists.

Mitigation: enforce the non-goals above. New Rust scope requires a separate proposal
with its own boundary and measurements.

### Strict decoding can block schema evolution

Risk: `deny_unknown_fields` catches drift but prevents older readers from accepting a
new writer's fields.

Mitigation: decide versioning before persistence. Either keep a closed schema with
coordinated releases or add an explicit pointer schema version and compatibility table;
do not accidentally get one policy from serde defaults.

### A shared kernel does not guarantee correct capture

Risk: both hosts can call the same encoder with the wrong `VersionId`, ETag, path, or
file content hash.

Mitigation: integration tests must begin at the backend response and assert the final
tree entry. The kernel removes serialization drift; it does not replace end-to-end
capture tests.

## Evidence from the spike

The current experiment demonstrates:

- byte-identical LFS and remote pointer output through Rust, Python, and JavaScript;
- stable ordering even if another Cargo dependency enables
  `serde_json/preserve_order`;
- strict validation and decode errors across both bindings;
- Python ABI3 and browser-compatible WASM build paths;
- one-time WASM initialization and `u64`/`BigInt` edge behavior;
- a small handwritten boundary: 240 Rust lines including tests, 64 PyO3 adapter lines,
  and 40 WASM adapter lines before production packaging.

It does not demonstrate:

- file-content hashing or LFS object ingestion;
- version-store or backend integration;
- supported-platform wheel publication;
- browser bundler integration;
- cold CI cost or release automation;
- performance under production snapshot volume.

## Alternatives considered

### Keep mirrored Python and TypeScript codecs

Lowest packaging cost. Shared golden fixtures can reduce drift, but there remain two
serializers, two validators, and two error models at a persistent identity boundary.
This remains the fallback if Phase 1's packaging gate fails.

### Generate one host implementation from a schema

A schema can generate types but does not fully define canonical JSON bytes, semantic
validation, error categories, content hashing, or runtime initialization. It reduces
typing duplication without creating one executable authority.

### Move more of Mirage core into Rust

Rejected. The current evidence supports one pure identity boundary only. Moving I/O or
workspace semantics would introduce async and ownership costs that this spike was
deliberately designed not to test.

## Maintainer acceptance criteria

Proceed from proposal to production work only if maintainers agree that:

- persistent pointer bytes need one executable authority;
- the wire decisions in Phase 0 are settled explicitly;
- the Python wheel and WASM artifact matrices fit Mirage's release budget;
- bindings remain private behind current versioning seams;
- Python and TypeScript ship the feature together;
- stored-data compatibility begins with the first release that writes pointers;
- any expansion beyond pointer identity requires a new proposal.

The requested decision is therefore narrow: approve a packaging-gated Rust
version-identity kernel for Phase 2a, or reject it and keep the shared fixture corpus as
the contract for mirrored host implementations.
