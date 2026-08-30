const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const devUrl = process.env.VITE_DEV_SERVER_URL;

function dataDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "data")
    : path.join(app.getAppPath(), "data");
}

function progressPath() {
  return path.join(app.getPath("userData"), "progress.json");
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
  ipcMain.handle("catalog:read", () =>
    readJson(path.join(dataDirectory(), "catalog.json")),
  );

  ipcMain.handle("word:read", (_event, wordId) => {
    if (!/^[a-f0-9-]{36}$/i.test(String(wordId))) {
      throw new Error("无效的单词标识");
    }
    return readJson(path.join(dataDirectory(), "words", `${wordId}.json`));
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
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f7f4ee",
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
    dialog.showErrorBox("词根记忆启动失败", `界面加载失败（${code}）：${description}`);
  });

  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.whenReady().then(() => {
  app.setAppUserModelId("com.cyword.desktop");
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
  dialog.showErrorBox("词根记忆发生错误", error?.stack || String(error));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
