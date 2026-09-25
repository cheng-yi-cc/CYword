import type { Catalog, WordDetail, WordsRequest, WordsResponse } from "./types.ts";

export interface InstalledBook {
  catalog(): Promise<Catalog>;
  words(request: WordsRequest): Promise<WordsResponse>;
  audioUrl(url: string): Promise<string>;
  imageUrl?(url: string): string;
}
export interface BundledManifest {
  schemaVersion: number;
  bookCode: string;
  dataVersion: string;
  wordCount: number;
  audio: Record<string, { file: string; bytes: number; sha256: string }>;
  images: Record<string, { file: string; bytes: number; sha256: string }>;
}

/** Read immutable installed files directly; never copy the book into user storage. */
export class BundledBook implements InstalledBook {
  private loaded?: Promise<{ catalog: Catalog; manifest: BundledManifest }>;
  private images?: BundledManifest["images"];
  private read: (file: string) => Promise<unknown>;
  private resolve: (file: string) => string;
  constructor(read: (file: string) => Promise<unknown>, resolve: (file: string) => string) { this.read = read; this.resolve = resolve; }
  private load() {
    return this.loaded ??= Promise.all([this.read("catalog.json"), this.read("manifest.json")]).then(([c, m]) => {
      const catalog = c as Catalog, manifest = m as BundledManifest;
      if (manifest.schemaVersion !== 1 || !catalog.dataVersion || catalog.dataVersion !== manifest.dataVersion
        || catalog.book.code !== manifest.bookCode || catalog.stats.wordCount !== manifest.wordCount
        || Object.keys(catalog.words).length !== manifest.wordCount || Object.keys(manifest.audio).length === 0 || !manifest.images) {
        throw new Error("安装包词书不完整，请重新安装应用；本机学习记录仍保留");
      }
      this.images = manifest.images;
      return { catalog, manifest };
    }).catch(error => { this.loaded = undefined; throw error; });
  }
  async catalog() { return (await this.load()).catalog; }
  async words(request: WordsRequest): Promise<WordsResponse> {
    const { catalog, manifest } = await this.load();
    if (request.dataVersion !== catalog.dataVersion) throw new Error("安装包词书版本不一致，请重新打开应用");
    const ids = [...new Set(request.wordIds)];
    if (ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id) || !Object.hasOwn(catalog.words, id))) throw new Error("本地词条不存在");
    const words = await Promise.all(ids.map(async id => {
      const word = await this.read(`words/${id}.json`) as WordDetail;
      if (word.id !== id || word.bookCode !== catalog.book.code || !Object.hasOwn(manifest.audio, word.audioUrl)) throw new Error("安装包词条不完整，请重新安装应用");
      return [id, word] as const;
    }));
    return { dataVersion: catalog.dataVersion, wordCount: ids.length, words: Object.fromEntries(words) };
  }
  async audioUrl(url: string) {
    const { manifest } = await this.load();
    const audio = Object.hasOwn(manifest.audio, url) ? manifest.audio[url] : undefined;
    if (!audio || !/^audio\/[a-f0-9]+\.(mp3|wav|ogg)$/i.test(audio.file)) throw new Error("安装包发音不存在，请重新安装应用");
    return this.resolve(audio.file);
  }
  imageUrl(url: string) {
    const key = new URL(url).href;
    const image = this.images && Object.hasOwn(this.images, key) ? this.images[key] : undefined;
    if (!image || !/^images\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(image.file)) throw new Error("安装包配图不完整，请重新安装应用");
    return this.resolve(image.file);
  }
}

export function installedBook(): InstalledBook | undefined {
  if (!import.meta.env?.PROD) return undefined;
  const resolve = (file: string) => new URL(`./book/${file}`, window.location.href).href;
  return new BundledBook(async file => {
    // Electron's file:// renderer cannot fetch JSON; read through its narrow IPC.
    if (window.cyword?.readBundledBookFile) return window.cyword.readBundledBookFile(file);
    const response = await fetch(resolve(file));
    if (!response.ok) throw new Error("安装包词书读取失败，请重新安装应用");
    return response.json();
  }, resolve);
}
