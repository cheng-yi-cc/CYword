const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyword", {
  readBundledBookFile: (file) => ipcRenderer.invoke("book:installed-file", file),
  readCatalog: () => ipcRenderer.invoke("catalog:read"),
  readWords: (request) => ipcRenderer.invoke("words:read", request),
  readProgress: (accountId) => ipcRenderer.invoke("progress:read", accountId),
  readProgressImport: (accountId) => ipcRenderer.invoke("progress:import-read", accountId),
  finishProgressImport: (accountId) => ipcRenderer.invoke("progress:import-finish", accountId),
  downloadBookAudio: (url) => ipcRenderer.invoke("book:audio", url),
  writeProgress: (progress, accountId) => ipcRenderer.invoke("progress:write", progress, accountId),
  syncProgress: (token, payload) => ipcRenderer.invoke("progress:sync", token, payload),
  sendAuthCode: (email) => ipcRenderer.invoke("auth:send-code", email),
  verifyAuthCode: (email, code) => ipcRenderer.invoke("auth:verify-code", email, code),
  getAuthUser: (token) => ipcRenderer.invoke("auth:me", token),
  readSession: () => ipcRenderer.invoke("session:read"),
  writeSession: (session) => ipcRenderer.invoke("session:write", session),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-state"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("update:status", wrapped);
    return () => ipcRenderer.removeListener("update:status", wrapped);
  },
});
