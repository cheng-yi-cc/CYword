import { normalizeProgress } from "./progress.ts";
import { mergeProgress } from "./sync-merge.ts";
import { validProgress } from "./progress-validation.ts";
import type { AppProgress, FlushResult } from "./types.ts";
export type { FlushResult } from "./types.ts";

export type SyncStatus = "syncing" | "synced" | "pending" | "error" | "offline" | "expired";
type Snapshot = { revision: number; progress: AppProgress; error?: string };
export interface SyncAdapter {
  isOnline?: () => boolean;
  read: () => Promise<unknown>;
  write: (progress: AppProgress) => Promise<unknown>;
  request: (payload?: { revision: number; progress: AppProgress }, knownRevision?: number) => Promise<{ status: number; data: Snapshot }>;
  change: (progress: AppProgress | null, status: SyncStatus, message: string) => void;
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
  private sessionExpired = false;
  private ready = false;
  private restored = false;
  private pending = false;
  private actor = crypto.randomUUID();
  private failures = 0;
  private nextAttempt = 0;
  private recoveryRequired = false;
  private recovered = false;
  private remote: Snapshot | null = null;
  constructor(adapter: SyncAdapter) { this.adapter = adapter; }
  async open() {
    let raw = await this.adapter.read();
    if (raw && typeof raw === "object" && "recoveryRequired" in raw && raw.recoveryRequired === true) {
      this.recoveryRequired = true;
      raw = null;
    }
    if (raw !== null && raw !== undefined && !validProgress(raw)) throw new Error("本机进度格式损坏，原记录已保留，请恢复有效副本");
    const local = raw as AppProgress | null;
    this.recovered = local?.localSync?.recovered === true;
    this.restored = local?.localSync?.restored === true;
    this.pending = local?.localSync?.pending ?? Boolean(local && Object.keys(local.words).length);
    this.progress = normalizeProgress(local);
    delete this.progress.localSync;
    this.ready = !this.recoveryRequired && (this.restored || Boolean(local && Object.keys(local.words).length));
    if (this.stopped) return;
    // Schedule migrations must also work offline, but become visible only after saving.
    if (this.adapter.reconcile && this.ready) await this.commit(this.progress);
    if (this.stopped) return;
    this.loaded = true;
    if (this.sessionExpired) {
      this.notify("expired", "登录已过期，已有本机记录会继续保留");
      return;
    }
    this.notify(this.pending ? "pending" : "syncing", this.ready ? "已保存本机，正在同步" : "正在恢复云端进度");
    await this.sync();
  }
  private notify(status: SyncStatus, message: string) {
    if (this.recovered) message = `已恢复有效进度，异常原件已保留。${message}`;
    this.message = message;
    if (!this.stopped) this.adapter.change(this.ready ? this.progress : null, status, message);
  }
  // Only durable snapshots become visible or eligible for upload. Serialize merging
  // and writing so a network response cannot overwrite a rating saved in flight.
  private commit(next: AppProgress, changedWords?: Set<string>, restoring = false, changedReviews = new Set<string>()) {
    const input = structuredClone(next);
    const operation = this.writes.catch(() => undefined).then(async () => {
      if (this.stopped) return;
      const candidate = input;
      if (changedWords) for (const id of changedWords) {
        const word = candidate.words[id];
        const counter = Math.max(word.ratingVersion?.counter ?? 0, this.progress.words[id]?.ratingVersion?.counter ?? 0) + 1;
        if (!Number.isSafeInteger(counter) || counter >= Number.MAX_SAFE_INTEGER) throw new Error("评级版本超出范围，请联系维护者恢复");
        word.ratingVersion = { counter, actor: this.actor };
        for (const item of candidate.reviewHistory) if (item.wordId === id && changedReviews.has(JSON.stringify(item))) item.ratingVersion = word.ratingVersion;
      }
      const merged = mergeProgress(this.progress, candidate);
      const snapshot = this.adapter.reconcile?.(merged) ?? merged;
      if (JSON.stringify(snapshot) !== JSON.stringify(this.progress) || (restoring && !this.restored)) {
        const saved = await this.adapter.write({ ...structuredClone(snapshot), localSync: { restored: restoring || this.restored, pending: true } });
        if (saved === false) throw new Error("设备拒绝保存进度");
        this.progress = snapshot;
        this.cloudSynced = false;
        this.pending = true;
        if (restoring) { this.restored = true; this.ready = true; }
      }
    });
    this.writes = operation;
    return operation;
  }
  async save(next: AppProgress, baseline: AppProgress = this.progress) {
    if (this.stopped) throw new Error("账号已切换，请重新进入学习");
    if (!this.loaded || !this.ready) throw new Error("请先成功恢复云端进度");
    if (!validProgress(next)) throw new Error("学习进度格式无效，本机记录未更改");
    const changedWords = new Set(Object.keys(next.words).filter((id) => {
      const before = baseline.words[id], after = next.words[id];
      return !before || before.proficiency !== after.proficiency || before.lastSeenAt !== after.lastSeenAt
        || before.reviewCount !== after.reviewCount || before.exposures !== after.exposures;
    }));
    try {
      const previousReviews = new Set(baseline.reviewHistory.map((item) => JSON.stringify(item)));
      await this.commit(next, changedWords, false, new Set(next.reviewHistory.map((item) => JSON.stringify(item)).filter((item) => !previousReviews.has(item))));
      if (this.stopped) throw new Error("账号已切换，请重新进入学习");
      this.localError = "";
      if (this.sessionExpired) {
        this.notify("expired", "登录已过期，进度已保存在本机");
        return;
      }
      this.notify("pending", "已保存到设备，等待同步");
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(false); }, 800);
    } catch (error) {
      this.localError = `保存到设备失败：${error instanceof Error ? error.message : "请重试"}`;
      this.notify("error", this.localError);
      throw error;
    }
  }
  sync(force = true): Promise<void> {
    if (this.stopped || !this.loaded || this.sessionExpired) return Promise.resolve();
    if (this.active) return this.active;
    if (!force && performance.now() < this.nextAttempt) return Promise.resolve();
    this.active = this.exchange().finally(() => { this.active = null; });
    return this.active;
  }
  private async exchange() {
    this.cloudSynced = false;
    this.notify("syncing", "正在同步进度");
    try {
      if (this.adapter.isOnline?.() === false) throw new Error("设备未联网");
      let response = await this.adapter.request(undefined, this.remote?.revision);
      if (response.status === 304 && this.remote) {
        if (!this.pending && this.ready) {
          this.cloudSynced = true; this.failures = 0; this.nextAttempt = 0;
          this.notify(this.localError ? "error" : "synced", this.localError || "已同步");
          return;
        }
        response = { status: 200, data: this.remote };
      }
      for (let attempt = 0; attempt <= 5; attempt++) {
        if (this.stopped || this.sessionExpired) return;
        if (response.status === 401) {
          this.expireSession();
          return;
        }
        if (response.status !== 200 && response.status !== 409) throw new Error(response.data?.error || "网络连接中断，请重试同步");
        if (!Number.isSafeInteger(response.data.revision) || response.data.revision < 0 || !validProgress(response.data.progress)
          || response.data.progress.localSync !== undefined) throw new Error("云端进度格式异常，已保留本机记录，请重试或联系维护者");
        const remote = response.data.progress;
        this.remote = { revision: response.data.revision, progress: remote };
        if (this.recoveryRequired && response.data.revision === 0) throw new Error("本机记录损坏且云端没有可恢复记录，异常原件已保留，请联系维护者");
        await this.commit(remote, undefined, true);
        if (this.recoveryRequired) { this.recoveryRequired = false; this.recovered = true; }
        if (this.stopped || this.sessionExpired) return;
        const remoteCanonical = mergeProgress(remote, remote);
        if (await this.acknowledge(remoteCanonical)) {
          this.failures = 0;
          this.nextAttempt = 0;
          this.notify(this.localError ? "error" : "synced", this.localError || "已同步");
          return;
        }
        if (attempt === 5) break;
        response = await this.adapter.request({ revision: response.data.revision, progress: structuredClone(this.progress) });
      }
      if (response.status === 200) {
        // Successful uploads followed by new local ratings are not conflicts.
        // Yield after a bounded batch, then send the durable remainder promptly.
        this.failures = 0;
        this.nextAttempt = 0;
        this.notify("pending", "已保存本机，正在继续同步");
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.sync(false); }, 800);
      } else {
        this.notify("pending", "设备正在同时学习，稍后继续同步");
        this.backoff();
      }
    } catch (error) {
      this.backoff();
      const offline = this.adapter.isOnline ? !this.adapter.isOnline() : typeof navigator !== "undefined" && navigator.onLine === false;
      this.notify(offline && this.ready ? "offline" : "error", this.localError || (this.recoveryRequired && error instanceof Error ? error.message : !this.ready ? "云端进度尚未恢复，请联网后重试。" : offline ? "离线，进度已保存本机" : (error instanceof Error ? error.message : "同步失败，进度已保存在设备上")));
    }
  }
  private backoff() {
    this.nextAttempt = performance.now() + Math.min(60_000, 1000 * 2 ** Math.min(++this.failures, 6));
  }
  private acknowledge(remote: AppProgress): Promise<boolean> {
    // Acknowledgement shares the write queue. A rating queued during the request
    // cannot be swept into an older acknowledgement or marked uploaded.
    let acknowledged = false;
    const operation = this.writes.catch(() => undefined).then(async () => {
      if (this.stopped || JSON.stringify(this.progress) !== JSON.stringify(remote)) return;
      if (this.pending) {
        const saved = await this.adapter.write({ ...structuredClone(this.progress), localSync: { restored: true, pending: false } });
        if (saved === false) throw new Error("同步确认保存失败，请重试");
      }
      this.pending = false;
      this.cloudSynced = true;
      acknowledged = true;
    });
    this.writes = operation;
    return operation.then(() => acknowledged);
  }
  async flush(): Promise<FlushResult> {
    clearTimeout(this.timer);
    await this.writes.catch(() => undefined);
    if (!this.sessionExpired) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.sync(), new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2500); })]);
      clearTimeout(timeout);
    }
    await this.writes.catch(() => undefined);
    const localSaved = this.loaded && this.ready && !this.localError;
    return { localSaved, cloudSynced: localSaved && this.cloudSynced, message: this.localError || this.message };
  }
  expireSession() {
    if (this.stopped || this.sessionExpired) return;
    this.sessionExpired = true;
    clearTimeout(this.timer);
    if (this.loaded) this.notify(this.localError ? "error" : "expired", this.localError || "登录已过期，进度已保存在本机");
    this.adapter.unauthorized?.();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
