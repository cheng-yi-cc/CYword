import { isPublicRelease, type PublicRelease } from "../website/server/release-manifest.ts";

export type AndroidUpdateState = {
  status: "idle" | "checking" | "current" | "available" | "opening" | "error";
  currentVersion: string;
  release?: PublicRelease;
  message?: string;
};
export type AndroidUpdates = Pick<AndroidUpdateService, "getSnapshot" | "subscribe" | "check" | "download">;
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
    now?: () => number;
  };
  constructor(dependencies: AndroidUpdateService["dependencies"]) { this.dependencies = dependencies; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: AndroidUpdateState) { this.state = state; this.listeners.forEach(listener => listener()); }

  check = (automatic = false): Promise<void> => {
    if (this.checking) return this.checking;
    if (this.opening) return this.opening;
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

  download = (): Promise<void> => {
    if (this.opening) return this.opening;
    if (this.checking || this.state.status !== "available" || !this.state.release) return Promise.resolve();
    const ready = this.state;
    this.set({ ...ready, status: "opening", message: undefined });
    this.opening = Promise.resolve().then(async () => {
      try {
        await this.dependencies.open(origin + ready.release!.downloadPath);
        this.set({ ...ready, message: "已打开浏览器，下载后点击 APK 安装" });
      } catch { this.set({ ...ready, message: "无法打开下载，请重试" }); }
      finally { this.opening = null; }
    });
    return this.opening;
  };
}
