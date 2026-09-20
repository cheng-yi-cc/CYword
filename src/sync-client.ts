import { normalizeProgress } from "./progress.ts";
import { mergeProgress } from "./sync-merge.ts";
import type { AppProgress } from "./types.ts";

export type SyncStatus = "syncing" | "synced" | "pending" | "error";
type Snapshot = { revision: number; progress: AppProgress; error?: string };
export interface SyncAdapter {
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
  private writes: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private adapter: SyncAdapter;
  constructor(adapter: SyncAdapter) { this.adapter = adapter; }
  async open() {
    this.progress = normalizeProgress(await this.adapter.read());
    if (this.stopped) return;
    this.progress = this.adapter.reconcile?.(this.progress) ?? this.progress;
    this.notify("syncing", "正在同步进度");
    await this.sync();
  }
  private notify(status: SyncStatus, message: string) {
    if (!this.stopped) this.adapter.change(this.progress, status, message);
  }
  private merge(next: AppProgress) {
    const value = mergeProgress(this.progress, next);
    this.progress = this.adapter.reconcile?.(value) ?? value;
  }
  private persist() {
    const snapshot = structuredClone(this.progress);
    this.writes = this.writes.catch(() => undefined).then(() => this.adapter.write(snapshot));
    return this.writes;
  }
  async save(next: AppProgress) {
    if (this.stopped) throw new Error("账号已切换，请重新进入学习");
    this.merge(next);
    await this.persist();
    this.notify("pending", "已保存到设备，等待同步");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.sync(); }, 800);
  }
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.exchange().finally(() => { this.active = null; });
    return this.active;
  }
  private async exchange() {
    this.notify("syncing", "正在同步进度");
    try {
      let response = await this.adapter.request();
      for (let attempt = 0; attempt <= 5; attempt++) {
        if (this.stopped) return;
        if (response.status === 401) {
          this.stop();
          this.adapter.unauthorized?.();
          return;
        }
        if (attempt === 5) break;
        if (response.status !== 200 && response.status !== 409) throw new Error(response.data?.error || "网络连接中断，请重试同步");
        if (!Number.isSafeInteger(response.data.revision) || response.data.progress?.version !== 2) throw new Error("同步服务尚未就绪，请稍后重试");
        const remote = response.data.progress;
        this.merge(remote);
        await this.persist();
        const remoteCanonical = mergeProgress(remote, remote);
        if (JSON.stringify(this.progress) === JSON.stringify(remoteCanonical)) {
          this.notify("synced", "已与云端同步");
          return;
        }
        const snapshot = structuredClone(this.progress);
        response = await this.adapter.request({ revision: response.data.revision, progress: snapshot });
      }
      this.notify("pending", "设备正在同时学习，稍后继续同步");
    } catch (error) {
      this.notify("error", error instanceof Error ? error.message : "同步失败，进度已保存在设备上");
    }
  }
  async flush() { clearTimeout(this.timer); await this.writes; await this.sync(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
