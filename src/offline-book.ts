import type { Catalog, WordDetail, WordsRequest, WordsResponse } from "./types";
import { applyCurriculum } from "./curriculum.ts";
import { installedBook, type InstalledBook } from "./bundled-book.ts";

type BookRecord = { catalog: Catalog; ready: boolean };
export type DownloadState = { phase: "words" | "audio"; completed: number; total: number };
export interface BookStorage {
  record(): Promise<BookRecord | undefined>;
  setRecord(record: BookRecord): Promise<void>;
  words(version: string, ids: string[]): Promise<Array<WordDetail | undefined>>;
  putWords(version: string, words: WordDetail[]): Promise<void>;
  audio(url: string): Promise<Blob | undefined>;
  putAudio(url: string, audio: Blob): Promise<void>;
}

export class IndexedBookStorage implements BookStorage {
  private database?: Promise<IDBDatabase>;
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cyword-offline-books", 1);
      request.onupgradeneeded = () => {
        for (const name of ["meta", "words", "audio"]) request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = undefined; };
        resolve(request.result);
      };
      request.onerror = () => { this.database = undefined; reject(request.error); };
      request.onblocked = () => { this.database = undefined; reject(new Error("请关闭其他 CYword 页面后重试")); };
    });
  }
  private async transaction<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>[]) {
    const db = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(name, mode, { durability: "strict" });
      const requests = run(tx.objectStore(name));
      tx.oncomplete = () => resolve(requests.map(request => request.result));
      tx.onabort = () => reject(tx.error || new Error("词书保存失败，请检查设备剩余空间"));
      tx.onerror = () => reject(tx.error || new Error("词书存储不可用"));
    });
  }
  async record() { return (await this.transaction<BookRecord | undefined>("meta", "readonly", store => [store.get("cet6")]))[0]; }
  async setRecord(record: BookRecord) { await this.transaction("meta", "readwrite", store => [store.put(record, "cet6")]); }
  words(version: string, ids: string[]) { return this.transaction<WordDetail | undefined>("words", "readonly", store => ids.map(id => store.get([version, id]))); }
  async putWords(version: string, words: WordDetail[]) { await this.transaction("words", "readwrite", store => words.map(word => store.put(word, [version, word.id]))); }
  async audio(url: string) { return (await this.transaction<Blob | undefined>("audio", "readonly", store => [store.get(url)]))[0]; }
  async putAudio(url: string, audio: Blob) { await this.transaction("audio", "readwrite", store => [store.put(audio, url)]); }
}

export class OfflineBook {
  private active: Promise<Catalog> | null = null;
  private installed?: BookRecord;
  private objectUrls = new Map<string, string>();
  private storage: BookStorage;
  private bundled?: InstalledBook;
  private source: {
    catalog: () => Promise<Catalog>;
    words: (request: WordsRequest) => Promise<WordsResponse>;
    audio: (url: string) => Promise<Blob>;
  };
  constructor(storage: BookStorage, source: OfflineBook["source"], bundled?: InstalledBook) { this.storage = storage; this.source = source; this.bundled = bundled; }
  async inspect() {
    if (this.installed) return this.installed;
    if (this.bundled) return this.installed = { catalog: await this.bundled.catalog(), ready: true };
    const record = await this.storage.record();
    if (record?.ready) this.installed = record;
    return record;
  }
  download(change: (state: DownloadState) => void): Promise<Catalog> {
    if (this.bundled) return this.bundled.catalog();
    if (this.active) return this.active;
    this.active = this.transfer(change).finally(() => { this.active = null; });
    return this.active;
  }
  private async downloadWords(catalog: Catalog, ids: string[], saved: (count: number) => void): Promise<void> {
    let response: WordsResponse | undefined;
    let failure: unknown;
    let valid = false;
    // Retry a failed response with smaller requests, down to one word. A complete
    // outage stops on the first failing single word (at most eight requests).
    for (let attempt = 0; attempt < (ids.length === 1 ? 2 : 1); attempt++) {
      try {
        response = await this.source.words({ dataVersion: catalog.dataVersion, planDay: 1, kind: "bookmarks", wordIds: ids });
      } catch (error) { failure = error; response = undefined; }
      if (response?.dataVersion && response.dataVersion !== catalog.dataVersion) {
        throw new Error("词书分片版本不一致，请稍后重试下载");
      }
      valid = !!response && response.dataVersion === catalog.dataVersion && response.wordCount === ids.length
        && ids.every(id => response!.words?.[id]?.id === id && response!.words[id].bookCode === catalog.book.code && !!response!.words[id].audioUrl);
      if (valid) break;
    }
    if (!valid) {
      if (ids.length > 1) {
        const middle = Math.ceil(ids.length / 2);
        await this.downloadWords(catalog, ids.slice(0, middle), saved);
        await this.downloadWords(catalog, ids.slice(middle), saved);
        return;
      }
      const spelling = catalog.words[ids[0]]?.spelling || ids[0];
      throw new Error(`“${spelling}”下载失败，请检查网络后继续下载`, { cause: failure ?? new Error("词书分片不完整") });
    }
    // Storage failures must surface immediately, never trigger network retries.
    await this.storage.putWords(`${catalog.book.code}:${catalog.dataVersion}`, ids.map(id => response!.words[id]));
    saved(ids.length);
  }
  private async transfer(change: (state: DownloadState) => void) {
    const previous = await this.storage.record();
    if (previous?.ready) return previous.catalog;
    const catalog = previous?.catalog ?? await this.source.catalog();
    const groups = new Map(catalog.groups?.map(group => [group.id, group.wordIds]) ?? []);
    // Match the server's study-day shards to avoid rereading every shard per batch.
    const scheduled = catalog.schedule?.flatMap(day => day.groupIds.flatMap(id => groups.get(id) ?? [])) ?? [];
    const ids = [...new Set([...scheduled, ...Object.keys(catalog.words)])];
    if (!catalog.dataVersion || !/^[a-z0-9][a-z0-9_-]*$/.test(catalog.book.code) || !ids.length || ids.length !== catalog.stats.wordCount) throw new Error("词书目录不完整，请重试下载");
    await this.storage.setRecord({ catalog, ready: false });
    const version = `${catalog.book.code}:${catalog.dataVersion}`;
    const audioUrls = new Set<string>();
    let completedWords = 0;
    for (let offset = 0; offset < ids.length; offset += 64) {
      const batch = ids.slice(offset, offset + 64);
      const local = await this.storage.words(version, batch);
      const missing = batch.filter((_, index) => !local[index]);
      completedWords += batch.length - missing.length;
      if (missing.length) {
        // Count each committed sub-batch, including when a later sub-batch fails.
        await this.downloadWords(catalog, missing, count => {
          completedWords += count;
          change({ phase: "words", completed: completedWords, total: ids.length });
        });
      }
      const complete = await this.storage.words(version, batch);
      for (const word of complete) {
        if (!word?.audioUrl) throw new Error("词书发音信息缺失，请重试下载");
        audioUrls.add(word.audioUrl);
      }
      change({ phase: "words", completed: completedWords, total: ids.length });
    }
    const urls = [...audioUrls];
    let index = 0, completed = 0;
    let failure: unknown;
    change({ phase: "audio", completed, total: urls.length });
    // Bounded concurrency; settle every worker before permitting another attempt.
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < urls.length && !failure) {
        const url = urls[index++];
        try {
          if (!(await this.storage.audio(url))?.size) {
            const audio = await this.source.audio(url);
            if (!audio.size || audio.size > 5_000_000 || !/^(audio\/|application\/octet-stream)/i.test(audio.type)) throw new Error("词书音频格式无效，请重试下载");
            await this.storage.putAudio(url, audio);
          }
          change({ phase: "audio", completed: ++completed, total: urls.length });
        } catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    await this.storage.setRecord({ catalog, ready: true });
    this.installed = { catalog, ready: true };
    return catalog;
  }
  async readWords(request: WordsRequest): Promise<WordsResponse> {
    if (this.bundled) return this.bundled.words(request);
    const record = await this.inspect();
    if (!record?.ready || record.catalog.dataVersion !== request.dataVersion) throw new Error("请先完成词书下载");
    const ids = [...new Set(request.wordIds)];
    const words = await this.storage.words(`${record.catalog.book.code}:${request.dataVersion}`, ids);
    if (words.some(word => !word)) throw new Error("本地词条读取失败，请重试");
    return { dataVersion: request.dataVersion, wordCount: ids.length, words: Object.fromEntries(ids.map((id, index) => [id, words[index]!])) };
  }
  async audioUrl(url: string) {
    if (this.bundled) return this.bundled.audioUrl(url);
    const cached = this.objectUrls.get(url);
    if (cached) { this.objectUrls.delete(url); this.objectUrls.set(url, cached); return cached; }
    const blob = await this.storage.audio(url);
    if (!blob?.size) throw new Error("本地音频读取失败，请检查词书下载");
    const resolved = this.objectUrls.get(url);
    if (resolved) return resolved;
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.set(url, objectUrl);
    if (this.objectUrls.size > 8) {
      const oldest = this.objectUrls.keys().next().value!;
      URL.revokeObjectURL(this.objectUrls.get(oldest)!);
      this.objectUrls.delete(oldest);
    }
    return objectUrl;
  }
  imageUrl(url: string) { return this.bundled?.imageUrl?.(url) ?? url; }
}

export const offlineBook = new OfflineBook(new IndexedBookStorage(), {
  catalog: async () => applyCurriculum(await window.cyword.readCatalog()),
  words: request => window.cyword.readWords(request),
  audio: async url => {
    if (!window.cyword.downloadBookAudio) throw new Error("请更新应用后下载离线发音");
    const { base64, contentType } = await window.cyword.downloadBookAudio(url);
    return new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: contentType });
  },
}, installedBook());
