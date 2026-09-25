import { isPublicRelease, type PublicRelease } from "../website/server/release-manifest.ts";

export type AndroidUpdateState = {
  status: "idle" | "checking" | "current" | "available" | "opening" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  release?: PublicRelease;
  message?: string;
};
export type AndroidUpdates = Pick<AndroidUpdateService, "getSnapshot" | "subscribe" | "check" | "download" | "downloadFull" | "install">;
export type AndroidDownloadProgress = { phase: string; completed: number; total: number; downloaded: number };
const origin = "https://cyword.chengyi.me";
const automaticInterval = 6 * 60 * 60 * 1000;

export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (version: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("版本号无效");
    return version.split(".").map(BigInt);
  };
  const next = parse(candidate), current = parse(installed);
  for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return next[i] > current[i];
  return false;
}

export class AndroidUpdateService {
  private state: AndroidUpdateState = { status: "idle", currentVersion: "" };
  private listeners = new Set<() => void>();
  private checking: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private lastAutomaticCheck = -Infinity;
  private dependencies: {
    version: () => Promise<string>;
    release: () => Promise<unknown>;
    open: (url: string) => Promise<void>;
    prepare?: (release: PublicRelease, progress: (value: AndroidDownloadProgress) => void) => Promise<{ downloadedBytes: number }>;
    install?: () => Promise<{ permissionRequired: boolean }>;
    now?: () => number;
  };
  constructor(dependencies: AndroidUpdateService["dependencies"]) { this.dependencies = dependencies; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: AndroidUpdateState) { this.state = state; this.listeners.forEach(listener => listener()); }

  check = (automatic = false): Promise<void> => {
    if (this.checking) return this.checking;
    if (this.opening) return this.opening;
    if (this.state.status === "ready") return Promise.resolve();
    const now = (this.dependencies.now ?? Date.now)();
    if (automatic && now - this.lastAutomaticCheck < automaticInterval) return Promise.resolve();
    this.lastAutomaticCheck = now;
    const previous = this.state;
    this.set({ ...previous, status: "checking", message: undefined });
    this.checking = Promise.resolve().then(async () => {
      try {
        const currentVersion = await this.dependencies.version();
        this.set({ ...this.state, currentVersion });
        const release = await this.dependencies.release();
        if (!isPublicRelease(release, true)) throw new Error("更新信息无效");
        const newer = isNewerVersion(release.version, currentVersion);
        this.set({ status: newer ? "available" : "current", currentVersion, release: newer ? release : undefined });
      } catch {
        // A failed recheck must not discard an already validated download.
        this.set({ ...this.state, status: previous.release ? "available" : "error", release: previous.release, message: "检查失败，请重试" });
      } finally { this.checking = null; }
    });
    return this.checking;
  };

  downloadFull = () => this.download(true);
  download = (full = false): Promise<void> => {
    if (this.opening) return this.opening;
    if (this.checking || this.state.status !== "available" || !this.state.release) return Promise.resolve();
    const ready = this.state;
    const differential = !full && Boolean(ready.release?.differential && this.dependencies.prepare);
    this.set({ ...ready, status: differential ? "downloading" : "opening", message: differential ? "正在准备更新…" : undefined });
    this.opening = Promise.resolve().then(async () => {
      try {
        if (differential) {
          const result = await this.dependencies.prepare!(ready.release!, value => {
            if (this.state.status !== "downloading") return;
            const message = value.phase === "scanning" ? "正在准备更新…" : value.phase === "verifying" ? "正在校验更新…" : `下载更新 ${value.total ? Math.min(100, Math.floor(value.completed / value.total * 100)) : 100}%`;
            this.set({ ...this.state, message });
          });
          this.set({ ...ready, status: "ready", message: `更新已就绪，下载 ${(result.downloadedBytes / 1048576).toFixed(1)} MB` });
        } else {
          await this.dependencies.open(origin + ready.release!.downloadPath);
          this.set({ ...ready, message: "已打开浏览器，下载后点击 APK 安装" });
        }
      } catch (error) { this.set({ ...ready, message: differential ? (error instanceof Error ? error.message : "更新失败，请重试") : "无法打开下载，请重试" }); }
      finally { this.opening = null; }
    });
    return this.opening;
  };
  install = (): Promise<void> => {
    if (this.opening) return this.opening;
    if (this.state.status !== "ready" || !this.dependencies.install) return Promise.resolve();
    const ready = this.state;
    this.set({ ...ready, status: "installing", message: "正在打开安装…" });
    this.opening = Promise.resolve().then(async () => {
      try {
        const result = await this.dependencies.install!();
        this.set({ ...ready, message: result.permissionRequired ? "允许安装此来源的应用后，返回点击安装" : "请在系统窗口中完成安装" });
      } catch (error) {
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "UPDATE_NOT_READY";
        this.set({ ...ready, status: missing ? "available" : "ready", message: missing ? "更新文件已失效，请重新下载" : error instanceof Error ? error.message : "安装失败，请重试" });
      }
      finally { this.opening = null; }
    });
    return this.opening;
  };
}
