const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require("electron");
const { createProgressStore } = require("./progress-store.cjs");
const { createExitGuard } = require("./exit-guard.cjs");
const { validStoredProgress, encodeProgressWire, decodeProgressWire } = require("./generated/progress-validation.cjs");
const { readBundledBookFile } = require("./bundled-book.cjs");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const channel = require("./generated/channel.json");
{
  app.setName(channel.productName);
  app.setPath("userData", path.join(app.getPath("appData"), channel.productName));
}

const devUrl = process.env.VITE_DEV_SERVER_URL;
const bookApiUrl = process.env.CYWORD_BOOK_API_URL || (devUrl
  ? `${devUrl.replace(/\/$/, "")}/api/books/cet6`
  : `${channel.origin}/api/books/cet6`);
const authApiUrl = devUrl
  ? `${devUrl.replace(/\/$/, "")}/api/auth`
  : `${channel.origin}/api/auth`;
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
};
const progressStores = new Map();
let exitAllowed = false;
const exitReady = new WeakSet();
const exitSeen = new WeakSet();
const preparations = new Map();
function prepareWindow(window) {
  const sender = window.webContents;
  if (!exitSeen.has(sender)) return Promise.resolve({ localSaved: true, cloudSynced: true });
  if (!exitReady.has(sender)) return Promise.reject(new Error("界面正在恢复，请稍后再次关闭。"));
  return new Promise((resolve, reject) => {
    const nonce = randomUUID();
    const timer = setTimeout(() => {
      preparations.delete(nonce);
      reject(new Error("保存仍未确认，窗口已保留。请检查设备存储后重试。"));
    }, 30000);
    preparations.set(nonce, { sender, resolve: result => { clearTimeout(timer); resolve(result); } });
    sender.send("app:prepare-exit", nonce);
  });
}
const exitGuard = createExitGuard({
  prepare: async () => {
    const results = await Promise.all(BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(prepareWindow));
    return { localSaved: results.every(r => r.localSaved === true), cloudSynced: results.every(r => r.cloudSynced === true), message: results.find(r => !r.localSaved)?.message };
  },
  drain: async () => { for (const store of progressStores.values()) await store.drain(); },
  warn: message => dialog.showMessageBox({ type: "error", title: "暂时无法退出", message, buttons: ["返回应用"], noLink: true }),
  confirmPending: async () => (await dialog.showMessageBox({ type: "warning", title: "进度已保存本机", message: "云端同步尚未完成。退出后请保留当前设备数据，下次打开会继续同步。", buttons: ["返回应用", "继续退出"], defaultId: 0, cancelId: 0, noLink: true })).response === 1,
  release: () => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("app:release-exit"); },
  perform: action => {
    exitAllowed = true;
    try { if (action === "install") autoUpdater.quitAndInstall(true, true); else app.quit(); }
    catch (error) { exitAllowed = false; throw error; }
  },
});
function accountStore() {
  const accountId = "local";
  if (!progressStores.has(accountId)) progressStores.set(accountId, createProgressStore(progressPath(accountId), validStoredProgress, { encode: encodeProgressWire, decode: decodeProgressWire }));
  return progressStores.get(accountId);
}

function publishUpdateState(next) {
  updateState = { ...updateState, ...next };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("update:status", updateState);
  }
}

function updateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function configureAutoUpdater() {
  if (!app.isPackaged) return;
  if (channel.name === "acceptance") autoUpdater.setFeedURL({ provider: "generic", url: `${channel.origin}/downloads/`, channel: "latest", useMultipleRangeRequest: false });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("update-available", (info) => {
    publishUpdateState({
      status: "downloading",
      version: info.version,
      percent: 0,
      message: "",
    });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateState({ status: "idle", version: undefined, percent: undefined, message: "" });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateState({
      status: "downloading",
      percent: Math.max(0, Math.min(100, progress.percent)),
      message: "",
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateState({
      status: "downloaded",
      version: info.version,
      percent: 100,
      message: "",
    });
  });
  autoUpdater.on("error", (error) => {
    const wasDownloading = updateState.status === "downloading";
    console.warn("CYword update error:", error);
    publishUpdateState(wasDownloading
      ? { status: "available", percent: 0, message: "下载失败，点击重试" }
      : { status: "idle", version: undefined, percent: undefined, message: "" });
  });
}

function checkForUpdatesOnce() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().then((result) => result?.downloadPromise).catch((error) => {
    console.warn("CYword update check/download failed:", updateErrorMessage(error));
  });
}

function progressPath() { return path.join(app.getPath("userData"), "progress.json"); }

async function fetchBookJson(pathname, options = {}) {
  const response = await fetch(`${bookApiUrl}${pathname}`, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`词库服务暂时不可用（${response.status}），请检查网络后重试`);
  }
  return response.json();
}

async function registerIpc() {
  ipcMain.on("app:exit-ready", (event, ready) => {
    if (!BrowserWindow.getAllWindows().some(w => w.webContents === event.sender)) return;
    if (ready === true) { exitSeen.add(event.sender); exitReady.add(event.sender); }
    else exitReady.delete(event.sender);
  });
  ipcMain.on("app:exit-prepared", (event, nonce, result) => {
    const pending = preparations.get(nonce);
    if (!pending || pending.sender !== event.sender || !result || typeof result.localSaved !== "boolean" || typeof result.cloudSynced !== "boolean") return;
    preparations.delete(nonce);
    pending.resolve({ localSaved: result.localSaved, cloudSynced: result.cloudSynced, message: typeof result.message === "string" ? result.message.slice(0, 500) : "" });
  });
  ipcMain.handle("book:installed-file", (_event, file) => readBundledBookFile(path.join(app.getAppPath(), "dist", "book"), file));
  ipcMain.handle("book:audio", async (_event, value) => {
    const url = new URL(value);
    if (url.origin !== "https://cdn.aimwords.com" || !/^\/audio\/[a-f0-9]+\.(?:mp3|wav)$/i.test(url.pathname) || url.search || url.username || url.password) throw new Error("词书音频地址无效");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`音频下载失败（${response.status}）`);
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 5_000_000 || !/^(audio\/|application\/octet-stream)/i.test(contentType)) throw new Error("词书音频格式无效");
    return { base64: bytes.toString("base64"), contentType };
  });
  ipcMain.handle("catalog:read", () => fetchBookJson("/catalog"));

  ipcMain.handle("words:read", (_event, request) => {
    if (!request || !Array.isArray(request.wordIds)) throw new Error("每日词汇请求格式无效");
    return fetchBookJson("/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  });

  ipcMain.handle("progress:read", async (_event, accountId) => {
    return accountStore(accountId).read();
  });

  ipcMain.handle("progress:write", async (_event, progress, accountId) => {
    return accountStore(accountId).write(progress);
  });

  ipcMain.handle("update:get-state", () => updateState);

  ipcMain.handle("update:download", async () => {
    if (!app.isPackaged || updateState.status !== "available") return updateState;
    publishUpdateState({ status: "downloading", percent: 0, message: "" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publishUpdateState({
        status: "available",
        percent: 0,
        message: "下载失败，点击重试",
      });
      console.warn("CYword update download failed:", updateErrorMessage(error));
    }
    return updateState;
  });

  ipcMain.handle("update:install", async () => {
    if (!app.isPackaged || updateState.status !== "downloaded") return false;
    return exitGuard.request("install");
  });
}

function createWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1440, area.width), height = Math.min(920, area.height);
  const window = new BrowserWindow({
    width,
    height,
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    minWidth: Math.min(760, area.width),
    minHeight: Math.min(560, area.height),
    backgroundColor: "#f7f4ee",
    icon: path.join(__dirname, "assets", "icon.ico"),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f7f4ee", symbolColor: "#3d3929", height: 40 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on("close", event => {
    if (exitAllowed) return;
    event.preventDefault();
    void exitGuard.request("close");
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    dialog.showErrorBox("CYword 启动失败", `界面加载失败（${code}）：${description}`);
  });
  window.webContents.once("did-finish-load", checkForUpdatesOnce);

  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.whenReady().then(async () => {
  app.setAppUserModelId(channel.desktopId);
  configureAutoUpdater();
  await registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("CYword 启动失败", error instanceof Error ? error.message : "初始化失败，请重试");
  app.quit();
});

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

process.on("uncaughtException", (error) => {
  dialog.showErrorBox("CYword 发生错误", error?.stack || String(error));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", event => {
  if (exitAllowed || BrowserWindow.getAllWindows().length === 0) return;
  event.preventDefault();
  void exitGuard.request("close");
});
