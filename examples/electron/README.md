# Electron example

A minimal main-process integration: `main.js` owns the `SublimeKeysClient`
instance and exposes `activate`/`verify` to the renderer through a
`contextBridge`-scoped `preload.js`, keeping `contextIsolation: true` and
`nodeIntegration: false` — the secure Electron defaults.

From your renderer/UI code:

```js
const result = await window.license.activate(userEnteredKey);
if (result.valid) unlockFullVersion();
```

## Packaging notes

Because this SDK is pure JS/TS on top of `node:crypto` and `node:fs` (no
native addon, no platform-specific prebuilt binary), there's nothing extra to
configure in `electron-builder` or `electron-forge`'s `asar` packaging or
native-module rebuild step. It packages exactly like any other pure-JS
dependency.
