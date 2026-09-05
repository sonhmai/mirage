# Changelog

## Unreleased

- Keep timers responsive during large in-memory line reads, cache drains, and `wc` scans in Python and TypeScript; propagate caller cancellation into builtin processing and close cancelled producers (#1002).
