# sublimekeys

Official Node.js/Electron SDK for [SublimeKeys](https://keys.sublimearts.io) —
license key activation, verification and trials for indie desktop apps, with
**offline-capable verification**: once a license is activated, your app can
verify it locally in milliseconds with no network call, for up to 7 days at a
time, before quietly re-syncing online.

Zero runtime dependencies — Ed25519 verification uses Node's built-in
`node:crypto`, so there's nothing to native-compile and nothing for a bundler
or `asar` packaging step to trip over.

```bash
npm install sublimekeys
```

Requires Node.js 20+ (any current Electron release ships a much newer Node
than that).

## Quickstart

This mirrors the lifecycle described in the [SublimeKeys docs](https://keys.sublimearts.io/docs):
first run activates, every later run verifies (offline-first), uninstall
deactivates.

```ts
import { SublimeKeysClient } from "sublimekeys";

const client = new SublimeKeysClient("my-app");

// First run — ask the user for their key once.
const activated = await client.activate(userEnteredKey);
if (activated.valid) unlockFullVersion();

// Every later launch — offline-first, instant, falls back online
// automatically once the cached lease's 7-day trust window lapses.
const result = await client.verify(savedKey);
if (result.valid) unlockFullVersion();
console.log(result.source); // "offline_cache" most days, "online" roughly weekly

// Uninstall / sign out.
await client.deactivate(savedKey);
```

`client.getMachineId()` gives you a stable, locally-persisted identifier if
you need to store it yourself — every method above also generates and caches
one automatically the first time it's needed, so passing it explicitly is
optional.

## Trials

```ts
const trial = await client.startTrial(); // get-or-create a 7-day trial; idempotent —
                                          // reinstalling never resets the clock
if (trial.status === "active") console.log(`${trial.daysLeft} days left`);

const status = await client.trialStatus(); // read-only check, never starts one
```

## How offline verification works

When `activate()` or `verify()` succeeds, the server returns a lease — a small
Ed25519-signed token proving "this license is valid for this machine, as of
now." The SDK caches it locally and, on every later `verify()` call, checks
the signature against a **pinned public key built into this package** — no
network call, no dependency on the server being reachable.

The lease itself expires after 7 days (server-controlled). Once it does, the
next `verify()` call transparently goes online, gets a fresh lease, and the
cycle repeats. This means a revoked or expired license can take up to 7 days
to be caught while a machine stays fully offline — an intentional tradeoff for
instant, network-independent checks the rest of the time, not a bug.

## API

| Method | What it does |
|---|---|
| `activate(licenseKey, machineId?)` | First run. Always online. |
| `verify(licenseKey, machineId?, { allowOffline? })` | Every later run. Offline-first by default. |
| `deactivate(licenseKey, machineId?)` | Uninstall/sign-out. Frees the seat, clears the local cache. |
| `startTrial(machineId?)` | Get-or-create a trial. |
| `trialStatus(machineId?)` | Read-only trial check. |
| `getMachineId()` | Stable per-install identifier (auto-generated, persisted locally). |

All methods return a plain object (`LicenseResult` or `TrialResult`) — they
never throw for a normal "not valid" outcome. Network failures are caught
internally too; `verify()` falls back to the offline cache or a
`{ valid: false, source: "offline_cache_miss" }` result rather than throwing.

## Using this in an Electron app

This SDK is Node-only (it uses `node:crypto` and `node:fs`), so it needs to
run in Electron's **main process**, not directly in a renderer with
`contextIsolation` on (the recommended, secure default). Two common patterns:

- Call `SublimeKeysClient` methods in `main.ts`/`main.js` and expose the
  results to the renderer over IPC (`ipcMain.handle` / `contextBridge`).
- Or run it from a preload script if you've deliberately scoped Node access
  there.

See `examples/electron/` for a minimal main-process integration, including
the IPC wiring.

Because verification uses only built-in Node APIs (no native addon, no
prebuilt binary per-platform), there's nothing extra to configure in
`electron-builder`/`electron-forge`'s `asar` packaging or native-rebuild step
— the whole SDK is plain JS/TS.

## License

MIT
