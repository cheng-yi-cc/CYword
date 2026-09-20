import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { App as NativeApp } from "@capacitor/app";
import type { AppProgress, UserSession, WordsRequest } from "./types";

export const isNative = Capacitor.isNativePlatform();
const DeviceStorage = registerPlugin<{
  readSession(): Promise<{ value: string | null }>;
  writeSession(options: { value: string }): Promise<void>;
  clearSession(): Promise<void>;
  writeProgress(options: { key: string; value: string }): Promise<void>;
}>("DeviceStorage");
const origin = "https://cyword.chengyi.me";
const storage = {
  get: async (key: string) => isNative ? (await Preferences.get({ key })).value : localStorage.getItem(key),
  set: async (key: string, value: string) => { if (isNative) await Preferences.set({ key, value }); else localStorage.setItem(key, value); },
  remove: async (key: string) => { if (isNative) await Preferences.remove({ key }); else localStorage.removeItem(key); },
};
async function request(path: string, method = "GET", data?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (isNative) {
    const response = await CapacitorHttp.request({ url: `${origin}${path}`, method, data, headers, responseType: "json", connectTimeout: 15000, readTimeout: 30000 });
    return { status: response.status, data: response.data };
  }
  const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store", signal: AbortSignal.timeout(30000) });
  return { status: response.status, data: await response.json() };
}
async function json(path: string, method = "GET", data?: unknown) {
  const response = await request(path, method, data);
  if (response.status < 200 || response.status >= 300) throw new Error(response.data?.error || `连接失败（${response.status}），请检查网络后重试`);
  return response.data;
}
const progressKey = (accountId?: string) => `cyword-progress:${accountId || "guest"}`;
async function readSession() {
  const raw = isNative ? (await DeviceStorage.readSession()).value : await storage.get("cyword_session");
  return raw ? JSON.parse(raw) as UserSession : null;
}

export function installPlatform() {
  const legacySession = readSession().catch(() => null);
  if (!window.cyword) window.cyword = {
    readCatalog: () => json("/api/books/cet6/catalog"),
    readWords: (data: WordsRequest) => json("/api/books/cet6/words", "POST", data),
    readProgress: async (accountId) => {
      const stored = await storage.get(progressKey(accountId));
      if (stored) return JSON.parse(stored);
      // One-time ownership prevents a second account inheriting the first account's legacy progress.
      const owner = await storage.get("cyword-legacy-owner");
      if (accountId && !owner && (await legacySession)?.user.id === accountId) {
        const legacy = await storage.get("cyword-preview-progress");
        await storage.set("cyword-legacy-owner", accountId);
        if (legacy) { await storage.set(progressKey(accountId), legacy); return JSON.parse(legacy); }
      }
      return null;
    },
    writeProgress: async (progress: AppProgress, accountId) => {
      const key = progressKey(accountId), value = JSON.stringify(progress);
      if (isNative) await DeviceStorage.writeProgress({ key, value }); else await storage.set(key, value);
      return true;
    },
    syncProgress: (token, payload) => request("/api/progress", payload ? "PUT" : "GET", payload, token),
    sendAuthCode: (email) => json("/api/auth/send-code", "POST", { email }),
    verifyAuthCode: (email, code) => json("/api/auth/verify-code", "POST", { email, code }),
    readSession,
    writeSession: async (session) => {
      if (isNative) await DeviceStorage.writeSession({ value: JSON.stringify(session) }); else await storage.set("cyword_session", JSON.stringify(session));
      return true;
    },
    clearSession: async () => { if (isNative) await DeviceStorage.clearSession(); else await storage.remove("cyword_session"); return true; },
  };
  if (isNative) {
    document.documentElement.classList.add("native-app");
    void NativeApp.addListener("backButton", () => {
      const event = new Event("cyword-back", { cancelable: true });
      if (window.dispatchEvent(event)) void NativeApp.minimizeApp();
    });
    void NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) window.dispatchEvent(new Event("cyword-resume")); });
  }
}
