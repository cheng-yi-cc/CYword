const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const devUrl = process.env.VITE_DEV_SERVER_URL;
const bookApiUrl = process.env.CYWORD_BOOK_API_URL || (devUrl
  ? `${devUrl.replace(/\/$/, "")}/api/books/cet6`
  : "https://cyword.chengyi.me/api/books/cet6");
const authApiUrl = devUrl
  ? `${devUrl.replace(/\/$/, "")}/api/auth`
  : "https://cyword.chengyi.me/api/auth";
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
};

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

function progressPath(accountId) {
  if (accountId) return path.join(app.getPath("userData"), "accounts", createHash("sha256").update(String(accountId)).digest("hex"), "progress.json");
  return path.join(app.getPath("userData"), "progress.json");
}

function sessionPath() {
  return path.join(app.getPath("userData"), "session.json");
}

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

async function fetchAuthJson(pathname, options = {}) {
  const response = await fetch(`${authApiUrl}${pathname}`, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`认证服务响应格式异常（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `认证服务异常（${response.status}）`);
  }
  return data;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function registerIpc() {
  const legacySession = await readJson(sessionPath(), null);
  ipcMain.handle("catalog:read", () => fetchBookJson("/catalog"));

  ipcMain.handle("words:read", (_event, request) => {
    if (!request || !Array.isArray(request.wordIds)) throw new Error("每日词汇请求格式无效");
    return fetchBookJson("/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  });

  ipcMain.handle("auth:send-code", (_event, email) => {
    return fetchAuthJson("/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  });

  ipcMain.handle("auth:verify-code", (_event, email, code) => {
    return fetchAuthJson("/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
  });

  ipcMain.handle("auth:me", (_event, token) => {
    return fetchAuthJson("/me", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    });
  });

  ipcMain.handle("session:read", async () => {
    return (await readJson(sessionPath(), null));
  });

  ipcMain.handle("session:write", async (_event, session) => {
    if (!session || typeof session !== "object" || !session.token) {
      throw new Error("用户会话格式无效");
    }
    const target = sessionPath();
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(session, null, 2), "utf8");
    await fs.rename(temporary, target);
    return true;
  });

  ipcMain.handle("session:clear", async () => {
    try {
      await fs.unlink(sessionPath());
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    return true;
  });

  ipcMain.handle("progress:read", async (_event, accountId) => {
    if (accountId) {
      const saved = await readJson(progressPath(accountId), null);
      if (saved) return saved;
      const ownerPath = path.join(app.getPath("userData"), "progress-owner.json");
      const owner = await readJson(ownerPath, null);
      if (!owner && legacySession?.user?.id === accountId) {
        const legacy = await readJson(progressPath(), null);
        // Claim the legacy data once, retaining the old file for recovery.
        await fs.mkdir(path.dirname(progressPath(accountId)), { recursive: true });
        if (legacy) await fs.writeFile(progressPath(accountId), JSON.stringify(legacy), "utf8");
        await fs.writeFile(ownerPath, JSON.stringify({ accountId }), "utf8");
        return legacy;
      }
    }
    return (
      (await readJson(progressPath(accountId), null)) ?? {
        version: 2,
        planDays: {},
        words: {},
        bookmarks: {},
        reviewHistory: [],
      }
    );
  });

  ipcMain.handle("progress:write", async (_event, progress, accountId) => {
    if (!progress || progress.version !== 2 || typeof progress.words !== "object") {
      throw new Error("学习进度格式无效");
    }
    const target = progressPath(accountId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(progress, null, 2), "utf8");
    await fs.rename(temporary, target);
    return true;
  });

  ipcMain.handle("progress:sync", async (_event, token, payload) => {
    if (typeof token !== "string" || token.length > 10000) throw new Error("登录状态无效");
    const endpoint = devUrl ? `${devUrl.replace(/\/$/, "")}/api/progress` : "https://cyword.chengyi.me/api/progress";
    const response = await fetch(endpoint, {
      method: payload ? "PUT" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, data: await response.json() };
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

  ipcMain.handle("update:install", () => {
    if (!app.isPackaged || updateState.status !== "downloaded") return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f7f4ee",
    icon: path.join(__dirname, "assets", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
  app.setAppUserModelId("com.cyword.desktop");
  configureAutoUpdater();
  await registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
