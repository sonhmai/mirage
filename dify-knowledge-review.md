# Dify Knowledge Integration Review

## Findings

### 1. Command specs advertise flags that the Dify implementation does not actually support

Severity: high

The Dify command layer registers the shared Unix-like specs, but the implementation only handles a small subset of those flags and silently ignores the rest through `**_extra`.

Spec references:

- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:19)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:52)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:100)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:105)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:115)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:128)
- [python/mirage/commands/spec/builtin_specs.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/spec/builtin_specs.py:183)

Implementation references:

- [python/mirage/commands/builtin/dify/grep.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/grep.py:9)
- [python/mirage/core/dify/grep.py](/home/kiendn/Code/Projects/mirage/python/mirage/core/dify/grep.py:9)
- [python/mirage/commands/builtin/dify/ls.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/ls.py:10)
- [python/mirage/commands/builtin/dify/head.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/head.py:10)
- [python/mirage/commands/builtin/dify/tail.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/tail.py:10)
- [python/mirage/commands/builtin/dify/wc.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/wc.py:9)

Examples:

- `grep` only reads `-i`, but always formats output as `path:line:content`, which effectively behaves like `-H -n` are always on.
- `grep` ignores `-h`, `-c`, `-l`, `-q`, `-r`, `-R`, `-w`, `-F`, `-E`, `-o`, `-m`, `-A`, `-B`, `-C`, `-e`.
- `ls` only handles `-l` and `-h`; it ignores `-d`, `-R`, `-F`, `-1`, `-a`, `-A`, `-t`, `-S`, `-r`.
- `head` ignores `-c`.
- `tail` ignores `-c`, `-q`, `-v`, `-f`.
- `wc` ignores `-m`, `-L`.

I reproduced three concrete mismatches:

- `grep alpha /knowledge/guides/quickstart` still prints filename and line number even without flags.
- `head -c 3 /knowledge/quickstart` returns the full content instead of the first three bytes.
- `ls -d /knowledge/guides` lists the directory contents instead of the directory itself.

This is a real behavior bug, not just missing polish, because Mirage is explicitly advertising the standard flags via the shared command spec.

### 2. `ls` and `find` without explicit paths lose the mount prefix and populate the wrong index namespace

Severity: high

When no path is passed, both commands synthesize `PathSpec(original="/", directory="/")` without preserving the mount prefix or cwd.

References:

- [python/mirage/commands/builtin/dify/ls.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/ls.py:20)
- [python/mirage/commands/builtin/dify/find.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/find.py:49)
- [python/mirage/workspace/mount/mount.py](/home/kiendn/Code/Projects/mirage/python/mirage/workspace/mount/mount.py:407)
- [python/mirage/workspace/mount/mount.py](/home/kiendn/Code/Projects/mirage/python/mirage/workspace/mount/mount.py:419)
- [python/mirage/core/dify/path.py](/home/kiendn/Code/Projects/mirage/python/mirage/core/dify/path.py:20)
- [python/mirage/core/dify/tree.py](/home/kiendn/Code/Projects/mirage/python/mirage/core/dify/tree.py:11)

`Mount.execute_cmd()` already injects `prefix` and `cwd`, but these two commands discard that information and rebuild a root path by hand.

Observed effect:

- After `cd /knowledge && ls`, the Dify index contains both `/guides` and `/knowledge/guides`.
- That means the same remote tree is being cached into two namespaces: the mount-aware one and a synthetic root namespace.

This is cache pollution and will make relative-path behavior around mount roots unreliable.

### 3. `ls` catches `Exception` broadly and degrades internal failures into warnings

Severity: medium

Reference:

- [python/mirage/commands/builtin/dify/ls.py](/home/kiendn/Code/Projects/mirage/python/mirage/commands/builtin/dify/ls.py:25)

The repository rules explicitly say not to silently swallow exceptions. Here, `ls` catches every exception from `readdir()` and turns it into `ls: cannot access ...`.

That means:

- internal logic bugs,
- unexpected index errors,
- HTTP/client failures from the Dify backend

can all be flattened into a normal warning path.

This will make regressions harder to diagnose and masks failures that should surface during development.

### 4. Test coverage misses the main behavior regressions in the Dify command layer

Severity: medium

References:

- [python/tests/commands/builtin/dify/test_commands.py](/home/kiendn/Code/Projects/mirage/python/tests/commands/builtin/dify/test_commands.py:31)
- [python/tests/workspace/test_dify_resource.py](/home/kiendn/Code/Projects/mirage/python/tests/workspace/test_dify_resource.py:42)

Current tests cover the happy path for:

- tree population,
- basic read/stat behavior,
- basic command execution with absolute paths.

They do not cover:

- `cd /knowledge && ls` or `find` with no explicit path,
- `ls -d`,
- `head -c`,
- `tail -c`,
- `grep` flag semantics such as `-h`, `-H`, `-n`, `-c`, `-q`,
- the mismatch between declared command specs and actual behavior.

Because of that, the Dify-specific suite passes while the command surface still has obvious semantic bugs.

## Verification

I ran:

```bash
cd python && uv run pytest tests/core/dify tests/commands/builtin/dify tests/resource/dify tests/workspace/test_dify_resource.py
```

Result:

- 14 tests passed.

That confirms the existing suite is green, but it does not contradict the findings above. The uncovered cases are exactly where the current issues live.

## Summary

The core Dify pieces (`tree`, `read`, `stat`, HTTP client) look mostly reasonable. The main problems are in the command layer:

1. declared shell semantics are broader than the actual implementation,
1. default-path handling around mount prefixes is wrong in `ls` and `find`,
1. exception handling in `ls` is too broad,
1. tests do not cover the problematic command behaviors.
