const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");

const devUrl = process.env.VITE_DEV_SERVER_URL;
const bookApiUrl = devUrl
  ? `${devUrl.replace(/\/$/, "")}/api/books/cet6`
  : "https://cyword.chengyi.me/api/books/cet6";
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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("update-available", (info) => {
    publishUpdateState({
      status: "available",
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
  autoUpdater.checkForUpdates().catch((error) => {
    console.warn("CYword update check failed:", updateErrorMessage(error));
  });
}

function progressPath() {
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

function registerIpc() {
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

  ipcMain.handle("progress:read", async () => {
    return (
      (await readJson(progressPath(), null)) ?? {
        version: 2,
        planDays: {},
        words: {},
        bookmarks: {},
        reviewHistory: [],
      }
    );
  });

  ipcMain.handle("progress:write", async (_event, progress) => {
    if (!progress || progress.version !== 2 || typeof progress.words !== "object") {
      throw new Error("学习进度格式无效");
    }
    const target = progressPath();
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(progress, null, 2), "utf8");
    await fs.rename(temporary, target);
    return true;
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

app.whenReady().then(() => {
  app.setAppUserModelId("com.cyword.desktop");
  configureAutoUpdater();
  registerIpc();
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
