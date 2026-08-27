# Rust pointer-codec spike

Disposable vertical slice for the canonical LFS/remote pointer boundary discussed in
`strukto-ai/mirage#721`. It changes no production package or call site.

## Shape

```text
Python versioning seam ── PyO3 ─┐
                               ├─ Rust codec: validate → canonical JSON → SHA-256
TypeScript versioning seam ─ WASM┘
```

The Rust crate owns the wire contract. Both adapters are intentionally thin and
synchronous after module initialization:

- `crates/core`: tagged pointer model, validation, strict decode, canonical compact
  JSON, and hash.
- `crates/python`: CPython 3.11+ ABI-stable extension returning Python `bytes`.
- `crates/wasm`: browser-compatible WASM exports returning `Uint8Array` through
  generated `wasm-bindgen` glue.
- Both adapters expose encode, strict decode/canonicalize, and canonical hash for
  either pointer kind; hosts never implement the wire rules themselves.

The spike deliberately excludes resource I/O, async work, workspace state, and
production integration. Optional remote identity fields encode as explicit `null`,
and at least one of `etag` or `version_id` is required. That is a candidate contract
demonstrated here, not a settled Mirage API.

## What the bindings feel like

Python is a normal synchronous call:

```python
import mirage_pointer_codec_py as codec

data = codec.encode_lfs_pointer("sha256:" + "0" * 64, 1_048_576)
```

WASM has a one-time async initialization and maps Rust `u64` to JavaScript `BigInt`:

```javascript
import init, { encode_lfs_pointer } from './mirage_pointer_codec_wasm.js'

await init({ module_or_path: wasmBytes })
const data = encode_lfs_pointer(`sha256:${'0'.repeat(64)}`, 1_048_576n)
```

Mirage's current Python and TypeScript version snapshot/read paths are already async.
Keeping initialization and `BigInt` conversion behind those internal seams avoids a
public API change. Putting this in TypeScript core would instead impose WASM lifecycle
and browser-bundle cost on unrelated consumers.

## Build and verify

From this directory:

```sh
cargo test --workspace

rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
cargo build --release --target wasm32-unknown-unknown -p mirage-pointer-codec-wasm
wasm-bindgen --target web --out-dir pkg/web \
  target/wasm32-unknown-unknown/release/mirage_pointer_codec_wasm.wasm
node --test javascript/pointer_codec.test.mjs

python -m venv .venv
uv pip install --python .venv/bin/python 'maturin==1.15.0'
.venv/bin/maturin develop --manifest-path crates/python/Cargo.toml
.venv/bin/python -m unittest python/test_pointer_codec.py
```

The CLI pin must match the `wasm-bindgen` crate version in `Cargo.lock`.

Observed on Apple Silicon in this spike:

- Rust core: 7 tests, including canonical ordering with serde_json's additive
  `preserve_order` feature enabled.
- Python adapter: 4 tests; ABI3 wheel 538,043 bytes.
- WASM adapter: 4 tests; 177,424-byte release WASM (71,175 bytes gzip, without
  `wasm-opt`) plus 9,512-byte glue.
- Handwritten implementation: 240 core lines including tests, 64 Python-adapter
  lines, and 40 WASM-adapter lines.

## Readout

This boundary is technically plausible and small. The Rust-owned bytes and hash are
identical through Rust, Python, and JavaScript, and validation errors preserve their
meaning through both adapters. The meaningful cost is packaging, not core logic:
platform wheels for Python, a WASM build/glue step for TypeScript, one-time async WASM
initialization, and `BigInt` conversion at the JavaScript edge.

The next useful experiment would integrate this crate only behind the existing
version-state transforms and measure package/release complexity. Expanding into VFS,
resources, or command dispatch before that would not answer the current uncertainty.
