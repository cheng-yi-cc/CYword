import { normalizeProgress } from "./progress.ts";
import { mergeProgress } from "./sync-merge.ts";
import type { AppProgress } from "./types.ts";

export type SyncStatus = "syncing" | "synced" | "local" | "pending" | "error";
export type FlushResult = { localSaved: boolean; cloudSynced: boolean; message: string };
type Snapshot = { revision: number; progress: AppProgress; error?: string };
export interface SyncAdapter {
  mode?: "local" | "cloud";
  readImport?: () => Promise<boolean>;
  finishImport?: () => Promise<unknown>;
  read: () => Promise<unknown>;
  write: (progress: AppProgress) => Promise<unknown>;
  request: (payload?: { revision: number; progress: AppProgress }) => Promise<{ status: number; data: Snapshot }>;
  change: (progress: AppProgress, status: SyncStatus, message: string) => void;
  reconcile?: (progress: AppProgress) => AppProgress;
  unauthorized?: () => void;
}

export class ProgressSync {
  progress = normalizeProgress(null);
  private stopped = false;
  private active: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private localError = "";
  private loaded = false;
  private cloudSynced = false;
  private message = "进度尚未准备好";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private adapter: SyncAdapter;
  private imported = false;
  private importMessage = "";
  constructor(adapter: SyncAdapter) { this.adapter = adapter; }
  async open() {
    this.progress = normalizeProgress(await this.adapter.read());
    if (this.stopped) return;
    // Schedule migrations must also work offline, but become visible only after saving.
    if (this.adapter.reconcile) await this.commit(this.progress);
    if (this.stopped) return;
    this.loaded = true;
    if (this.adapter.mode === "local") {
      this.imported = await this.adapter.readImport?.() ?? false;
      if (this.stopped) return;
      this.notify("local", "进度已保存在本机");
      await this.sync();
      return;
    }
    this.notify("syncing", "正在同步进度");
    await this.sync();
  }
  private notify(status: SyncStatus, message: string) {
    this.message = message;
    if (!this.stopped) this.adapter.change(this.progress, status, message);
  }
  // Only durable snapshots become visible or eligible for upload. Serialize merging
  // and writing so a network response cannot overwrite a rating saved in flight.
  private commit(next: AppProgress, changedWords?: Set<string>) {
    const input = structuredClone(next);
    const operation = this.writes.catch(() => undefined).then(async () => {
      if (this.stopped) return;
      const candidate = input;
      if (changedWords) for (const id of changedWords) {
        const word = candidate.words[id];
        const ratedAt = Date.parse(word.lastSeenAt);
        const observedAt = Date.parse(this.progress.words[id]?.lastSeenAt ?? "");
        // Keep the same timestamp ordering as already-released clients. A local
        // reassessment must follow every rating this device has already observed.
        word.lastSeenAt = new Date(Math.max(
          Number.isFinite(ratedAt) ? ratedAt : Date.now(),
          Number.isFinite(observedAt) ? observedAt + 1 : -Infinity,
        )).toISOString();
      }
      const merged = mergeProgress(this.progress, candidate);
      const snapshot = this.adapter.reconcile?.(merged) ?? merged;
      if (JSON.stringify(snapshot) !== JSON.stringify(this.progress)) {
        const saved = await this.adapter.write(structuredClone(snapshot));
        if (saved === false) throw new Error("设备拒绝保存进度");
        this.progress = snapshot;
        this.cloudSynced = false;
      }
    });
    this.writes = operation;
    return operation;
  }
  async save(next: AppProgress, baseline: AppProgress = this.progress) {
    if (this.stopped) throw new Error("账号已切换，请重新进入学习");
    if (!this.loaded) throw new Error("进度尚未准备好");
    const changedWords = new Set(Object.keys(next.words).filter((id) => {
      const before = baseline.words[id], after = next.words[id];
      return !before || before.proficiency !== after.proficiency || before.lastSeenAt !== after.lastSeenAt
        || before.reviewCount !== after.reviewCount || before.exposures !== after.exposures;
    }));
    try {
      await this.commit(next, changedWords);
      if (this.stopped) throw new Error("账号已切换，请重新进入学习");
      this.localError = "";
      if (this.adapter.mode === "local") {
        this.notify(this.importMessage ? "pending" : "local", this.importMessage || "进度已保存在本机");
        return;
      }
      this.notify("pending", "已保存到设备，等待同步");
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(); }, 800);
    } catch (error) {
      this.localError = `保存到设备失败：${error instanceof Error ? error.message : "请重试"}`;
      this.notify("error", this.localError);
      throw error;
    }
  }
  sync(): Promise<void> {
    if (this.stopped || !this.loaded) return Promise.resolve();
    if (this.active) return this.active;
    this.active = (this.adapter.mode === "local" ? this.importOnce() : this.exchange()).finally(() => { this.active = null; });
    return this.active;
  }
  private async importOnce() {
    if (this.imported) return;
    this.notify("syncing", "正在导入旧云端进度");
    try {
      // Local mode only reads the legacy cloud snapshot; it never uploads.
      const response = await this.adapter.request();
      if (this.stopped) return;
      if (response.status === 401) throw new Error("旧进度导入需要重新登录，本机记录已保留");
      if (response.status !== 200 || !Number.isSafeInteger(response.data.revision) || response.data.progress?.version !== 2) {
        throw new Error("旧进度尚未导入，联网后可重试");
      }
      await this.commit(response.data.progress);
      if (this.stopped) return;
      // Record completion only after the merged snapshot is durable.
      if (!this.adapter.finishImport || await this.adapter.finishImport() === false) throw new Error("旧进度已保存，导入标记保存失败，请重试");
      this.imported = true;
      this.importMessage = "";
      this.notify(this.localError ? "error" : "local", this.localError || "进度已保存在本机");
    } catch (error) {
      this.importMessage = error instanceof Error ? error.message : "旧进度尚未导入，联网后可重试";
      this.notify(this.localError ? "error" : "pending", this.localError || this.importMessage);
    }
  }
  private async exchange() {
    this.cloudSynced = false;
    this.notify("syncing", "正在同步进度");
    try {
      let response = await this.adapter.request();
      for (let attempt = 0; attempt <= 5; attempt++) {
        if (this.stopped) return;
        if (response.status === 401) {
          this.message = "登录已过期，进度保留在设备上";
          this.stop();
          this.adapter.unauthorized?.();
          return;
        }
        if (attempt === 5) break;
        if (response.status !== 200 && response.status !== 409) throw new Error(response.data?.error || "网络连接中断，请重试同步");
        if (!Number.isSafeInteger(response.data.revision) || response.data.progress?.version !== 2) throw new Error("同步服务尚未就绪，请稍后重试");
        const remote = response.data.progress;
        await this.commit(remote);
        if (this.stopped) return;
        const remoteCanonical = mergeProgress(remote, remote);
        if (JSON.stringify(this.progress) === JSON.stringify(remoteCanonical)) {
          this.cloudSynced = true;
          this.notify(this.localError ? "error" : "synced", this.localError || "已与云端同步");
          return;
        }
        response = await this.adapter.request({ revision: response.data.revision, progress: structuredClone(this.progress) });
      }
      this.notify("pending", "设备正在同时学习，稍后继续同步");
    } catch (error) {
      this.notify("error", this.localError || (error instanceof Error ? error.message : "同步失败，进度已保存在设备上"));
    }
  }
  async flush(): Promise<FlushResult> {
    clearTimeout(this.timer);
    await this.writes.catch(() => undefined);
    if (this.adapter.mode !== "local") await this.sync();
    await this.writes.catch(() => undefined);
    const localSaved = this.loaded && !this.localError;
    return { localSaved, cloudSynced: localSaved && this.cloudSynced, message: this.localError || this.message };
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
