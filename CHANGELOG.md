# Changelog

## 0.2.1 — unreleased

- Hardening: an unparseable `license_expires_at` / `lease_expires_at` in a lease used to compare as "not expired" (`now >= new Date("garbage")` is `false`), so the license looked non-expiring. It now fails closed with `LeaseError`, and `verify()` simply asks the server. Date-only expiries such as `"2027-11-13"` keep working. Covered by new tests.
- README: trial length is now configurable per product (7/14/30 days); new "Time-limited licenses" section; clarified that only *revoked* licenses can take up to 7 days to be noticed offline — an expired one is rejected as soon as its date passes.

## 0.2.0

- Fix: network errors were mislabelled `source: "online"`; they now report `source: "network_error"`
- New offline trial cache: `trialStatus()` replays the last server-confirmed snapshot when the network is unreachable

## 0.1.0 — 2026-07-09

Initial release.

- `SublimeKeysClient`: `activate`, `verify`, `deactivate`, `startTrial`, `trialStatus`, `getMachineId`
- Offline-capable `verify()` via Ed25519-signed leases — cached locally, verified with no network call, transparent fallback to the API once the 7-day trust window lapses
- Zero runtime dependencies — Ed25519 verification uses Node's built-in `node:crypto`
- Ships both ESM and CommonJS builds with bundled TypeScript types
