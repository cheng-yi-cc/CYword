const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyword", {
  desktop: true,
  readBundledBookFile: (file) => ipcRenderer.invoke("book:installed-file", file),
  readCatalog: () => ipcRenderer.invoke("catalog:read"),
  readWords: (request) => ipcRenderer.invoke("words:read", request),
  readProgress: (accountId) => ipcRenderer.invoke("progress:read", accountId),
  downloadBookAudio: (url) => ipcRenderer.invoke("book:audio", url),
  writeProgress: (progress, accountId) => ipcRenderer.invoke("progress:write", progress, accountId),
  syncProgress: (token, payload, etag) => ipcRenderer.invoke("progress:sync", token, payload, etag),
  progressRequest: (token, operation) => ipcRenderer.invoke("progress:incremental", token, operation),
  sendAuthCode: (email) => ipcRenderer.invoke("auth:send-code", email),
  verifyAuthCode: (email, code) => ipcRenderer.invoke("auth:verify-code", email, code),
  getAuthUser: (token) => ipcRenderer.invoke("auth:me", token),
  readSession: () => ipcRenderer.invoke("session:read"),
  writeSession: (session) => ipcRenderer.invoke("session:write", session),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-state"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onPrepareExit: (prepare, release) => {
    const request = async (_event, nonce) => {
      let result;
      try { result = await prepare(); }
      catch { result = { localSaved: false, cloudSynced: false, message: "本机保存失败，请重试。" }; }
      ipcRenderer.send("app:exit-prepared", nonce, result);
    };
    const cancel = () => release();
    ipcRenderer.on("app:prepare-exit", request);
    ipcRenderer.on("app:release-exit", cancel);
    ipcRenderer.send("app:exit-ready", true);
    return () => {
      ipcRenderer.removeListener("app:prepare-exit", request);
      ipcRenderer.removeListener("app:release-exit", cancel);
      ipcRenderer.send("app:exit-ready", false);
    };
  },
  onUpdateStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("update:status", wrapped);
    return () => ipcRenderer.removeListener("update:status", wrapped);
  },
});
