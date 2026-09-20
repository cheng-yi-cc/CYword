import type { WordDetail, WordsRequest, WordsResponse } from "./types.ts";

type WordKind = WordsRequest["kind"];
type Options = {
  bookCode: string;
  dataVersion: string;
  request: (request: WordsRequest) => Promise<WordsResponse>;
  capacity?: number;
};

/** 只缓存当前词书版本的详情；页面切换不影响缓存，失败请求允许立即重试。 */
export class WordResourceCache {
  private entries = new Map<string, WordDetail>();
  private pending = new Map<string, Promise<boolean>>();
  private listeners = new Set<() => void>();
  private value: Record<string, WordDetail> = {};
  private generation = 0;
  private options: Options;
  readonly capacity: number;

  constructor(options: Options) {
    this.options = options;
    this.capacity = Math.max(1, options.capacity ?? 256);
  }

  private key(id: string) { return `${this.options.bookCode}:${this.options.dataVersion}:${id}`; }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish() {
    this.value = Object.fromEntries([...this.entries.values()].map(word => [word.id, word]));
    this.listeners.forEach(listener => listener());
  }

  clear() {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
    this.publish();
  }

  async load(ids: string[], kind: WordKind, planDay: number): Promise<boolean> {
    const wanted = [...new Set(ids)];
    const missing: string[] = [];
    const waits = new Set<Promise<boolean>>();
    for (const id of wanted) {
      const key = this.key(id), cached = this.entries.get(key);
      if (cached) {
        this.entries.delete(key);
        this.entries.set(key, cached);
      } else if (this.pending.has(key)) waits.add(this.pending.get(key)!);
      else missing.push(id);
    }
    if (missing.length) {
      const generation = this.generation;
      // 延后一拍发起请求，先注册所有 ID，合并同一事件循环内的重复请求。
      const request = Promise.resolve().then(async () => {
        try {
          const response = await this.options.request({ dataVersion: this.options.dataVersion, kind, planDay, wordIds: missing });
          if (generation !== this.generation) return false;
          if (response.dataVersion !== this.options.dataVersion || missing.some(id => response.words?.[id]?.id !== id || response.words[id].bookCode !== this.options.bookCode)) return false;
          for (const id of missing) {
            this.entries.delete(this.key(id));
            this.entries.set(this.key(id), response.words[id]);
          }
          while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
          this.publish();
          return true;
        } catch {
          return false;
        } finally {
          if (generation === this.generation) for (const id of missing) this.pending.delete(this.key(id));
        }
      });
      missing.forEach(id => this.pending.set(this.key(id), request));
      waits.add(request);
    }
    return (await Promise.all(waits)).every(Boolean);
  }
}
