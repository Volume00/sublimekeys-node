# Changelog

## 0.1.0 — 2026-07-09

Initial release.

- `SublimeKeysClient`: `activate`, `verify`, `deactivate`, `startTrial`, `trialStatus`, `getMachineId`
- Offline-capable `verify()` via Ed25519-signed leases — cached locally, verified with no network call, transparent fallback to the API once the 7-day trust window lapses
- Zero runtime dependencies — Ed25519 verification uses Node's built-in `node:crypto`
- Ships both ESM and CommonJS builds with bundled TypeScript types
