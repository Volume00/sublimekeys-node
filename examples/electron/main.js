// Minimal Electron main-process integration.
//
// This SDK uses node:crypto and node:fs, so it must run in the main process
// (or a preload script with Node access) — never directly in a renderer with
// contextIsolation on, which is the secure Electron default.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { SublimeKeysClient } = require("sublimekeys");

const PRODUCT_ID = "my-app"; // replace with your own product slug from the dashboard
const client = new SublimeKeysClient(PRODUCT_ID);

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
}

// Renderer asks the main process to activate/verify over IPC — it never
// touches the SDK or the filesystem directly.
ipcMain.handle("license:activate", async (_event, licenseKey) => {
  const result = await client.activate(licenseKey);
  return result;
});

ipcMain.handle("license:verify", async (_event, licenseKey) => {
  const result = await client.verify(licenseKey);
  return result;
});

app.whenReady().then(createWindow);
