import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { App as NativeApp } from "@capacitor/app";
import type { AppProgress, UserSession, WordsRequest } from "./types";
import { AndroidUpdateService, type AndroidDownloadProgress } from "./android-updates";
import type { PublicRelease } from "../website/server/release-manifest";
import { createKeyValueProgressStore } from "./key-value-progress";
import { assertBookProgress } from "./progress-business";
import { installedProgressCatalog } from "./curriculum";
import type { FlushResult } from "./sync-client";
import { encodeProgressWire, decodeProgressWire } from "./progress-compression";
import { apiOrigin as origin } from "./api-origin";
import { startNetworkMonitor } from "./network-state";

export const isNative = Capacitor.isNativePlatform();
const DeviceStorage = registerPlugin<{
  readSession(): Promise<{ value: string | null }>;
  writeSession(options: { value: string }): Promise<void>;
  clearSession(): Promise<void>;
  writeProgress(options: { key: string; value: string; backup?: string }): Promise<void>;
}>("DeviceStorage");
const storage = {
  get: async (key: string) => isNative ? (await Preferences.get({ key })).value : localStorage.getItem(key),
  set: async (key: string, value: string) => { if (isNative) await Preferences.set({ key, value }); else localStorage.setItem(key, value); },
  remove: async (key: string) => { if (isNative) await Preferences.remove({ key }); else localStorage.removeItem(key); },
};
async function request(path: string, method = "GET", data?: unknown, token?: string, etag?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const progress = path === "/api/progress";
  if (progress) {
    headers["X-CYword-Progress-Format"] = "compact-v1";
    if (data) { const payload = data as { progress: AppProgress }; data = { ...payload, progress: await encodeProgressWire(payload.progress) }; }
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;
  if (isNative) {
    const response = await CapacitorHttp.request({ url: `${origin}${path}`, method, data, headers, responseType: "json", connectTimeout: 15000, readTimeout: 30000 });
    if (progress && (response.status === 200 || response.status === 409)) response.data.progress = await decodeProgressWire(response.data.progress);
    return { status: response.status, data: response.data };
  }
  const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store", signal: AbortSignal.timeout(30000) });
  const body = response.status === 304 ? {} : await response.json();
  if (progress && (response.status === 200 || response.status === 409)) body.progress = await decodeProgressWire(body.progress);
  return { status: response.status, data: body };
}
async function json(path: string, method = "GET", data?: unknown) {
  const response = await request(path, method, data);
  if (response.status < 200 || response.status >= 300) throw new Error(response.data?.error || `连接失败（${response.status}），请检查网络后重试`);
  return response.data;
}
const progressKey = (accountId?: string) => `cyword-progress:${accountId || "guest"}`;
const progressStores = new Map<string, ReturnType<typeof createKeyValueProgressStore>>();
function progressStore(accountId?: string) {
  const key = progressKey(accountId);
  if (!progressStores.has(key)) progressStores.set(key, createKeyValueProgressStore(key, {
    get: storage.get,
    put: async (name, value, backup) => {
      if (isNative) await DeviceStorage.writeProgress({ key: name, value, backup });
      else {
        if (backup !== undefined) localStorage.setItem(`${name}:backup`, backup);
        localStorage.setItem(name, value);
      }
    },
  }, (value): value is AppProgress => { try { assertBookProgress(value, installedProgressCatalog); return true; } catch { return false; } },
  { encode: encodeProgressWire, decode: decodeProgressWire }));
  return progressStores.get(key)!;
}
let prepareExit: (() => Promise<FlushResult>) | null = null;
let releaseExit: (() => void) | null = null;
async function protectNativeInstall(install: () => Promise<{ permissionRequired: boolean }>) {
  if (!prepareExit) throw new Error("学习界面尚未就绪，请稍后安装。");
  try {
    const result = await prepareExit();
    if (!result.localSaved) throw new Error(result.message || "本机保存失败，请重试后安装。");
    if (!result.cloudSynced && !window.confirm("进度已保存本机，云端同步尚未完成。请保留应用数据，下次打开会继续同步。继续安装？")) throw new Error("已取消安装，进度保留在本机。");
    return await install();
  } finally { releaseExit?.(); }
}
async function readSession() {
  const raw = isNative ? (await DeviceStorage.readSession()).value : await storage.get("cyword_session");
  return raw ? JSON.parse(raw) as UserSession : null;
}

export function installPlatform() {
  startNetworkMonitor();
  if (!window.cyword) window.cyword = {
    readCatalog: () => json("/api/books/cet6/catalog"),
    readWords: (data: WordsRequest) => json("/api/books/cet6/words", "POST", data),
    readProgress: (accountId) => progressStore(accountId).read(),
    writeProgress: (progress, accountId) => progressStore(accountId).write(progress),
    progressRequest: (token, operation) => request('/api/progress-incremental', 'POST', operation, token),
    syncProgress: (token, payload, etag) => request("/api/progress", payload ? "PUT" : "GET", payload, token, etag),
    sendAuthCode: (email) => json("/api/auth/send-code", "POST", { email }),
    verifyAuthCode: (email, code) => json("/api/auth/verify-code", "POST", { email, code }),
    readSession,
    downloadBookAudio: async (url) => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://cdn.aimwords.com" || !/^\/audio\/[a-f0-9]+\.(?:mp3|wav)$/i.test(parsed.pathname) || parsed.search || parsed.username || parsed.password) throw new Error("词书音频地址无效");
      const response = await CapacitorHttp.get({ url: isNative ? url : `/__book-audio${parsed.pathname}`, responseType: "arraybuffer", disableRedirects: true, connectTimeout: 15000, readTimeout: 30000 });
      if (response.status !== 200) throw new Error(`音频下载失败（${response.status}）`);
      return { base64: response.data, contentType: response.headers["content-type"] || response.headers["Content-Type"] || "audio/mpeg" };
    },
    writeSession: async (session) => {
      if (isNative) await DeviceStorage.writeSession({ value: JSON.stringify(session) }); else await storage.set("cyword_session", JSON.stringify(session));
      return true;
    },
    clearSession: async () => { if (isNative) await DeviceStorage.clearSession(); else await storage.remove("cyword_session"); return true; },
    onPrepareExit: (prepare, release) => {
      prepareExit = prepare; releaseExit = release;
      return () => { if (prepareExit === prepare) { prepareExit = null; releaseExit = null; } };
    },
  };
  if (isNative) {
    if (Capacitor.getPlatform() === "android") {
      const AppUpdates = registerPlugin<{
        openDownload(options: { url: string }): Promise<void>;
        prepareUpdate(options: { release: PublicRelease }): Promise<{ downloadedBytes: number }>;
        installUpdate(): Promise<{ permissionRequired: boolean }>;
        addListener(event: "progress", listener: (value: AndroidDownloadProgress) => void): Promise<{ remove(): Promise<void> }>;
      }>("AppUpdates");
      const updates = new AndroidUpdateService({
        version: async () => (await NativeApp.getInfo()).version,
        release: () => json("/downloads/android/latest.json"),
        open: url => AppUpdates.openDownload({ url }),
        prepare: async (release, progress) => {
          const listener = await AppUpdates.addListener("progress", progress);
          try { return await AppUpdates.prepareUpdate({ release }); } finally { await listener.remove(); }
        },
        install: () => protectNativeInstall(() => AppUpdates.installUpdate()),
      });
      window.cyword.androidUpdates = updates;
      void updates.check(true);
      window.addEventListener("cyword-resume", () => { void updates.check(true); });
    }
    document.documentElement.classList.add("native-app");
    void NativeApp.addListener("backButton", () => {
      const event = new Event("cyword-back", { cancelable: true });
      if (window.dispatchEvent(event)) void NativeApp.minimizeApp();
    });
    void NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) window.dispatchEvent(new Event("cyword-resume")); });
  }
}
