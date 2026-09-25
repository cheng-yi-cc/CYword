import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { BundledBook } from "../src/bundled-book.ts";
import { OfflineBook, type BookStorage } from "../src/offline-book.ts";

const require = createRequire(import.meta.url);
const { readBundledBookFile } = require("../electron/bundled-book.cjs");
const url = "https://cdn.aimwords.com/audio/abc.mp3";
const imageUrl = "https://cdn.aimwords.com/word-images/a/original.png";
const imageFile = `images/${"a".repeat(64)}.png`;
const catalog = { book: { code: "cet6" }, dataVersion: "installed-v1", stats: { wordCount: 1 }, words: { a: { id: "a" } } };
const detail = { id: "a", bookCode: "cet6", audioUrl: url, memoryMarkup: "原巧记" };
const manifest = { schemaVersion: 1, bookCode: "cet6", dataVersion: catalog.dataVersion, wordCount: 1, audio: { [url]: { file: "audio/abc.mp3", bytes: 42, sha256: "hash" } }, images: { [imageUrl]: { file: imageFile, bytes: 42, sha256: "a".repeat(64) } } };
const request = { dataVersion: catalog.dataVersion, planDay: 1, kind: "study" as const, wordIds: ["a"] };
function fixture() {
  const files: Record<string, unknown> = structuredClone({ "catalog.json": catalog, "manifest.json": manifest, "words/a.json": detail });
  return { files, bundle: new BundledBook(async file => { assert.ok(file in files); return files[file]; }, file => `file:///installed/book/${file}`) };
}

test("fresh installs and upgrades use installed words and audio without download or IndexedDB access", async () => {
  const { bundle } = fixture();
  const unavailable = async () => { throw Error("network and user book storage unavailable"); };
  const storage = new Proxy({}, { get: () => unavailable }) as BookStorage;
  for (let restart = 0; restart < 2; restart++) {
    const book = new OfflineBook(storage, { catalog: unavailable, words: unavailable, audio: unavailable }, bundle);
    assert.deepEqual(await book.inspect(), { catalog, ready: true });
    assert.deepEqual(await book.download(() => { throw Error("must not show download"); }), catalog);
    assert.deepEqual((await book.readWords(request)).words.a, detail);
    assert.equal(await book.audioUrl(url), "file:///installed/book/audio/abc.mp3");
    assert.equal(book.imageUrl(imageUrl), `file:///installed/book/${imageFile}`);
  }
});

test("bundled reader rejects mismatched versions, unknown words and remote audio fallbacks", async () => {
  const { bundle, files } = fixture();
  await assert.rejects(bundle.words({ ...request, dataVersion: "old-download" }), /版本不一致/);
  await assert.rejects(bundle.words({ ...request, wordIds: ["../session"] }), /不存在/);
  await assert.rejects(bundle.audioUrl("https://example.com/remote.mp3"), /不存在/);
  assert.throws(() => bundle.imageUrl("https://example.com/remote.png"), /不完整/);
  files["words/a.json"] = { ...detail, bookCode: "other" };
  await assert.rejects(bundle.words(request), /不完整/);
  const broken = fixture();
  (broken.files["manifest.json"] as typeof manifest).dataVersion = "wrong";
  await assert.rejects(broken.bundle.catalog(), /不完整/);
});

test("Electron installed-file IPC reads UTF-8 JSON and refuses paths outside the book", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cyword-bundle-"));
  try {
    await fs.writeFile(path.join(directory, "catalog.json"), JSON.stringify(catalog));
    assert.deepEqual(await readBundledBookFile(directory, "catalog.json"), catalog);
    for (const file of ["../session.json", "words/../../session.json", "words\\a.json", "C:/session.json", "audio/a.mp3", null]) {
      assert.throws(() => readBundledBookFile(directory, file), /Invalid installed book path/);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
