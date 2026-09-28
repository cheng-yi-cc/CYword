import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { App as NativeApp } from "@capacitor/app";
import type { AppProgress, WordsRequest } from "./types";
import { AndroidUpdateService, type AndroidDownloadProgress } from "./android-updates";
import type { PublicRelease } from "../website/server/release-manifest";
import { createKeyValueProgressStore } from "./key-value-progress";
import { assertBookProgress } from "./progress-business";
import { installedProgressCatalog } from "./curriculum";
import type { FlushResult } from "./sync-client";
import { encodeProgressWire, decodeProgressWire } from "./progress-compression";
import { apiOrigin as origin } from "./api-origin";

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
async function json(path: string, method = "GET", data?: unknown) {
  const headers = { "Content-Type": "application/json" };
  if (isNative) {
    const response = await CapacitorHttp.request({ url: origin + path, method, data, headers, responseType: "json", connectTimeout: 15000, readTimeout: 30000 });
    if (response.status !== 200) throw new Error("更新服务暂不可用，请稍后重试");
    return response.data;
  }
  const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("更新服务暂不可用，请稍后重试");
  return response.json();
}
const progressKey = (_accountId?: string) => "cyword-stable:progress:cet6";
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
    return await install();
  } finally { releaseExit?.(); }
}
export function installPlatform() {
  if (!window.cyword) window.cyword = {
    readCatalog: () => json("/api/books/cet6/catalog"),
    readWords: (data: WordsRequest) => json("/api/books/cet6/words", "POST", data),
    readProgress: (accountId) => progressStore(accountId).read(),
    writeProgress: (progress, accountId) => progressStore(accountId).write(progress),
    downloadBookAudio: async (url) => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://cdn.aimwords.com" || !/^\/audio\/[a-f0-9]+\.(?:mp3|wav)$/i.test(parsed.pathname) || parsed.search || parsed.username || parsed.password) throw new Error("词书音频地址无效");
      const response = await CapacitorHttp.get({ url: isNative ? url : `/__book-audio${parsed.pathname}`, responseType: "arraybuffer", disableRedirects: true, connectTimeout: 15000, readTimeout: 30000 });
      if (response.status !== 200) throw new Error(`音频下载失败（${response.status}）`);
      return { base64: response.data, contentType: response.headers["content-type"] || response.headers["Content-Type"] || "audio/mpeg" };
    },
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
        release: async () => {
          const release = await json("/downloads/stable/android/latest.json");
          if (release.channel !== "stable") throw new Error("更新渠道不匹配");
          return release;
        },
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
