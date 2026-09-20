import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";

async function updaterFixture() {
  const updater = new EventEmitter();
  const handlers = new Map();
  const published = [];
  let downloads = 0, installs = 0, fail = false;
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit("download-progress", { percent: 35 });
    if (fail) { const error = new Error("network interrupted"); updater.emit("error", error); throw error; }
    updater.emit("update-downloaded", { version: "0.4.5" });
  };
  updater.checkForUpdates = async () => {
    updater.emit("update-available", { version: "0.4.5" });
    return { downloadPromise: updater.autoDownload ? updater.downloadUpdate() : null };
  };
  updater.quitAndInstall = () => { installs++; };
  const electron = {
    app: { isPackaged: true, getVersion: () => "0.4.4", getPath: () => "/mock", requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {} },
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_, value) => published.push(value) } }] },
  };
  const mocks = {
    electron,
    "electron-updater": { autoUpdater: updater },
    "node:fs/promises": { readFile: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } },
    "node:path": { join: (...parts) => parts.join("/") },
    "node:crypto": {},
  };
  const context = vm.createContext({ require: (name) => mocks[name], process: { env: {}, on() {} }, console: { warn() {} }, setImmediate, __dirname: "/mock" });
  vm.runInContext(readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8") + "\nglobalThis.fixture = { configureAutoUpdater, checkForUpdatesOnce, registerIpc };", context);
  context.fixture.configureAutoUpdater();
  await context.fixture.registerIpc();
  return { updater, handlers, published, check: context.fixture.checkForUpdatesOnce, count: () => ({ downloads, installs }), fail: (value) => { fail = value; } };
}

test("detecting an update downloads automatically, while installation waits for one click", async () => {
  const app = await updaterFixture();
  assert.equal(await app.handlers.get("update:install")(), false);
  app.check();
  await new Promise(setImmediate);
  assert.equal(app.published[0].status, "downloading");
  assert.equal(app.published.at(-1).status, "downloaded");
  assert.deepEqual(app.count(), { downloads: 1, installs: 0 });
  assert.equal(app.updater.autoInstallOnAppQuit, false);
  assert.equal(await app.handlers.get("update:install")(), true);
  await new Promise(setImmediate);
  assert.deepEqual(app.count(), { downloads: 1, installs: 1 });
});

test("an automatic download failure is handled and the download button retries it", async () => {
  const app = await updaterFixture();
  app.fail(true);
  app.check();
  await new Promise(setImmediate);
  assert.equal(app.published.at(-1).status, "available");
  assert.match(app.published.at(-1).message, /重试/);
  assert.equal(await app.handlers.get("update:install")(), false);
  app.fail(false);
  await app.handlers.get("update:download")();
  assert.equal(app.published.at(-1).status, "downloaded");
  assert.deepEqual(app.count(), { downloads: 2, installs: 0 });
});
