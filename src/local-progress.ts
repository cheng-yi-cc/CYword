import { emptyProgress } from './progress.ts';
import { assertBookProgress, canonicalProgress } from './progress-business.ts';
import type { PlanCatalog } from './progress.ts';
import type { AppProgress, FlushResult } from './types.ts';

/** 本机单写入队列：磁盘确认之后才发布界面进度。 */
export class LocalProgress {
  private queue: Promise<unknown> = Promise.resolve();
  private current: AppProgress | null = null;
  private failure = '';
  private actor = crypto.randomUUID();
  private catalog: PlanCatalog;
  private storage: {
    read: () => Promise<unknown>;
    write: (value: AppProgress) => Promise<boolean>;
    change: (value: AppProgress) => void;
  };
  constructor(catalog: PlanCatalog, storage: LocalProgress["storage"]) { this.catalog = catalog; this.storage = storage; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(action);
    this.queue = next;
    return next;
  }
  open() {
    return this.serial(async () => {
      const raw = await this.storage.read();
      if (raw && typeof raw === 'object' && 'recoveryRequired' in raw) throw new Error('本机学习记录损坏，原记录已保留。请勿清理应用数据。');
      const progress = canonicalProgress(raw ?? emptyProgress(), this.catalog);
      if (raw === null && !await this.storage.write(progress)) throw new Error('无法创建本机学习记录，请检查存储空间后重试。');
      this.current = progress;
      this.storage.change(progress);
    });
  }
  save(value: AppProgress) {
    const candidate = structuredClone(value);
    return this.serial(async () => {
      if (!this.current) throw new Error('本机进度尚未就绪');
      try {
        assertBookProgress(candidate, this.catalog);
        for (const [id, word] of Object.entries(candidate.words)) {
          const previous = this.current.words[id];
          if (JSON.stringify(word) === JSON.stringify(previous)) continue;
          word.ratingVersion = { counter: Math.max(word.ratingVersion?.counter ?? 0, previous?.ratingVersion?.counter ?? 0) + 1, actor: this.actor };
          for (const entry of candidate.reviewHistory) {
            if (entry.wordId === id && !this.current.reviewHistory.some(old => JSON.stringify(old) === JSON.stringify(entry))) entry.ratingVersion = word.ratingVersion;
          }
        }
        delete candidate.localSync;
        const progress = canonicalProgress(candidate, this.catalog);
        if (!await this.storage.write(progress)) throw new Error('本机保存失败，请重试。');
        this.current = progress;
        this.failure = '';
        this.storage.change(progress);
      } catch (error) {
        this.failure = error instanceof Error ? error.message : '本机保存失败，请重试。';
        throw error;
      }
    });
  }
  async flush(): Promise<FlushResult> {
    await this.queue.catch(() => undefined);
    return { localSaved: Boolean(this.current) && !this.failure, cloudSynced: true, message: this.failure };
  }
}
