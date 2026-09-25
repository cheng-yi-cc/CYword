import { useEffect, useRef, useState } from "react";
import { ProgressSync, type SyncStatus, type FlushResult } from "./sync-client";
import { reconcileCompletion } from "./progress";
import type { AppProgress, Catalog, UserSession } from "./types";
import { sessionExpiresAt } from "./auth-session";

export const cloudProgressEnabled = import.meta.env.VITE_CYWORD_PROGRESS_MODE === "cloud";

export function useSyncedProgress(session: UserSession | null, catalog: Catalog | null, onSessionExpired: () => void) {
  const [state, setState] = useState<{ account: string; progress: AppProgress | null; status: SyncStatus; message: string }>({ account: "", progress: null, status: "syncing", message: "正在准备进度" });
  const ref = useRef<ProgressSync | null>(null);
  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;
  useEffect(() => {
    if (!session || !catalog) return;
    let active = true;
    const { token, user } = session;
    const sync = new ProgressSync({
      mode: cloudProgressEnabled ? "cloud" : "local",
      readImport: () => window.cyword.readProgressImport!(user.id),
      finishImport: () => window.cyword.finishProgressImport!(user.id),
      read: () => window.cyword.readProgress(user.id),
      write: (progress) => window.cyword.writeProgress(progress, user.id),
      request: (payload) => {
        if (!window.cyword.syncProgress) throw new Error("请更新电脑端后使用进度同步");
        return window.cyword.syncProgress(token, payload);
      },
      reconcile: (progress) => reconcileCompletion(progress, catalog),
      change: (progress, status, message) => { if (active) setState({ account: user.id, progress, status, message }); },
      unauthorized: () => {
        if (!active) return;
        expiredRef.current();
      },
    });
    ref.current = sync;
    const expiresAt = sessionExpiresAt(token);
    if (expiresAt !== null && expiresAt <= Date.now()) sync.expireSession();
    void sync.open().catch((error) => { if (active) setState({ account: user.id, progress: null, status: "error", message: `读取本机进度失败：${String(error)}` }); });
    const resume = () => { if (document.visibilityState !== "hidden") void sync.sync(); };
    const interval = cloudProgressEnabled ? window.setInterval(resume, 15000) : undefined;
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("cyword-resume", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false; sync.stop(); ref.current = null; clearInterval(interval);
      window.removeEventListener("online", resume); window.removeEventListener("focus", resume); window.removeEventListener("cyword-resume", resume); document.removeEventListener("visibilitychange", resume);
    };
  }, [session?.token, session?.user.id, catalog]);
  return {
    progress: state.account === session?.user.id ? state.progress : null,
    status: state.status, message: state.message,
    save: async (next: AppProgress) => {
      if (!ref.current || state.account !== session?.user.id || !state.progress) throw new Error("进度尚未准备好");
      await ref.current.save(next, state.progress);
    },
    sync: () => ref.current?.sync(),
    expireSession: () => ref.current?.expireSession(),
    flush: (): Promise<FlushResult> => ref.current?.flush() ?? Promise.resolve({ localSaved: false, cloudSynced: false, message: "进度尚未准备好" }),
  };
}
