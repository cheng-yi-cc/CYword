import assert from "node:assert/strict";
import test from "node:test";
import { OfflineBook, type BookStorage } from "../src/offline-book.ts";
import type { Catalog, WordDetail } from "../src/types.ts";

const catalog = { book: { code: "cet6" }, dataVersion: "v1", stats: { wordCount: 3 }, words: { a: {}, b: {}, c: {} } } as Catalog;
const words = Object.fromEntries(Object.keys(catalog.words).map(id => [id, { id, audioUrl: `https://cdn.aimwords.com/audio/${id}.mp3`, bookCode: "cet6" } as WordDetail]));
class MemoryStorage implements BookStorage {
  book: Awaited<ReturnType<BookStorage["record"]>>;
  details = new Map<string, WordDetail>();
  media = new Map<string, Blob>();
  failReady = false;
  async record() { return structuredClone(this.book); }
  async setRecord(value: NonNullable<MemoryStorage["book"]>) { if (value.ready && this.failReady) throw new Error("disk full"); this.book = structuredClone(value); }
  async words(version: string, ids: string[]) { return ids.map(id => this.details.get(`${version}:${id}`)); }
  async putWords(version: string, values: WordDetail[]) { for (const word of values) this.details.set(`${version}:${word.id}`, structuredClone(word)); }
  async audio(url: string) { return this.media.get(url); }
  async putAudio(url: string, value: Blob) { this.media.set(url, value); }
}
function fixture() {
  const storage = new MemoryStorage(), calls = { catalog: 0, words: 0, audio: [] as string[] };
  let fail = "";
  const source = {
    catalog: async () => { calls.catalog++; return structuredClone(catalog); },
    words: async (request: { dataVersion: string; wordIds: string[] }) => { calls.words++; return { dataVersion: request.dataVersion, wordCount: request.wordIds.length, words: Object.fromEntries(request.wordIds.map(id => [id, words[id]])) }; },
    audio: async (url: string) => { calls.audio.push(url); if (url === fail) throw new Error("offline"); return new Blob(["audio"], { type: "audio/mpeg" }); },
  };
  return { storage, calls, source, book: new OfflineBook(storage, source), fail: (url: string) => { fail = url; } };
}
test("offline book is readable after restart without calling the source", async () => {
  const f = fixture(); await f.book.download(() => {});
  assert.equal(f.storage.book?.ready, true);
  const restarted = new OfflineBook(f.storage, { catalog: async () => { throw Error("offline"); }, words: async () => { throw Error("offline"); }, audio: async () => { throw Error("offline"); } });
  assert.deepEqual(await restarted.download(() => {}), catalog);
  const result = await restarted.readWords({ dataVersion: "v1", planDay: 1, kind: "study", wordIds: ["a", "c"] });
  assert.deepEqual(Object.keys(result.words), ["a", "c"]);
  const url = await restarted.audioUrl(words.a.audioUrl);
  assert.match(url, /^blob:/);
  assert.equal(await (await fetch(url)).text(), "audio");
});
test("failed audio download resumes only missing files and never exposes an incomplete book", async () => {
  const f = fixture(); f.fail(words.b.audioUrl);
  await assert.rejects(f.book.download(() => {}), /offline/);
  assert.equal(f.storage.book?.ready, false);
  await assert.rejects(f.book.readWords({ dataVersion: "v1", planDay: 1, kind: "study", wordIds: ["a"] }), /完成词书下载/);
  const saved = [...f.storage.media.keys()], before = f.calls.audio.length;
  f.fail(""); await f.book.download(() => {});
  assert.equal(f.calls.words, 1); assert.equal(f.calls.catalog, 1);
  assert.equal(f.calls.audio.slice(before).some(url => saved.includes(url)), false);
  assert.equal(f.storage.media.size, 3); assert.equal(f.storage.book?.ready, true);
});
test("concurrent starts share a download and failed ready commit can be retried", async () => {
  const f = fixture(); f.storage.failReady = true;
  const first = f.book.download(() => {}); assert.equal(first, f.book.download(() => {}));
  await assert.rejects(first, /disk full/); assert.equal(f.storage.book?.ready, false);
  f.storage.failReady = false; await f.book.download(() => {});
  assert.equal(f.calls.words, 1); assert.equal(f.calls.audio.length, 3);
});
test("wrong versions, incomplete responses and non-audio payloads cannot become ready", async () => {
  const f = fixture();
  f.source.words = async () => ({ dataVersion: "wrong", wordCount: 0, words: {} });
  await assert.rejects(f.book.download(() => {}), /分片不完整/);
  assert.equal(f.storage.book?.ready, false);
  const g = fixture(); g.source.audio = async () => new Blob(["error"], { type: "text/html" });
  await assert.rejects(g.book.download(() => {}), /音频格式无效/);
  assert.equal(g.storage.book?.ready, false);
  const h = fixture(); await h.book.download(() => {});
  await assert.rejects(h.book.readWords({ dataVersion: "v2", planDay: 1, kind: "study", wordIds: ["a"] }), /完成词书下载/);
});
