const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyword", {
  readCatalog: () => ipcRenderer.invoke("catalog:read"),
  readWord: (wordId) => ipcRenderer.invoke("word:read", wordId),
  readProgress: () => ipcRenderer.invoke("progress:read"),
  writeProgress: (progress) => ipcRenderer.invoke("progress:write", progress),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-state"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("update:status", wrapped);
    return () => ipcRenderer.removeListener("update:status", wrapped);
  },
});
