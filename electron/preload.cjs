const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyword", {
  readCatalog: () => ipcRenderer.invoke("catalog:read"),
  readWord: (wordId) => ipcRenderer.invoke("word:read", wordId),
  readProgress: () => ipcRenderer.invoke("progress:read"),
  writeProgress: (progress) => ipcRenderer.invoke("progress:write", progress),
});
