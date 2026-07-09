const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("license", {
  activate: (licenseKey) => ipcRenderer.invoke("license:activate", licenseKey),
  verify: (licenseKey) => ipcRenderer.invoke("license:verify", licenseKey),
});
