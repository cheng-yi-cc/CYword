import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { onRequestPost } from "../website/functions/api/books/[book]/words.ts";

const projectRoot = process.cwd();
const apiRoot = path.join(projectRoot, ".work", "book-api", "cet6");
const pointer = JSON.parse(fs.readFileSync(path.join(apiRoot, "current.json"), "utf8"));
const versionRoot = path.join(apiRoot, pointer.dataVersion);
const manifest = JSON.parse(fs.readFileSync(path.join(versionRoot, "manifest.json"), "utf8"));

function r2JsonObject(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    body: new Blob([bytes]).stream(),
    json: async () => structuredClone(value),
  };
}

test("installer configuration does not package generated word data", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.equal(packageJson.build.extraResources, undefined);
  assert.ok(packageJson.build.files.every((pattern) => !pattern.startsWith("data")));
});

test("installer auto-updater uses the website generic provider", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.deepEqual(packageJson.build.publish, [{
    provider: "generic",
    url: "https://cyword.chengyi.me/downloads/",
    channel: "latest",
    useMultipleRangeRequest: false,
  }]);
});

test("API bundle assigns every word to exactly one study-day shard", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(versionRoot, "catalog.json"), "utf8"));
  assert.equal(catalog.generatedAt, undefined);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.wordCount, 5166);
  assert.equal(Object.keys(manifest.wordShard).length, 5166);
  assert.equal(Object.values(manifest.shards).reduce((sum, count) => sum + count, 0), 5166);
  assert.equal(Object.keys(manifest.shards).length, 30);
  for (const [shard, expectedCount] of Object.entries(manifest.shards)) {
    const pack = JSON.parse(fs.readFileSync(path.join(versionRoot, `shard-${shard}.json`), "utf8"));
    assert.equal(Object.keys(pack.words).length, expectedCount);
    assert.ok(Object.keys(pack.words).every((id) => manifest.wordShard[id] === shard));
  }
});

test("daily endpoint enforces the body limit even without Content-Length", async () => {
  let reads = 0;
  const response = await onRequestPost({
    request: new Request("https://example.test/api/books/cet6/words", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(400_001));
          controller.close();
        },
      }),
      duplex: "half",
    }),
    params: { book: "cet6" },
    env: { BOOKS: { get: async () => { reads += 1; return null; } } },
    waitUntil: () => undefined,
  });
  assert.equal(response.status, 413);
  assert.equal(reads, 0);
});

test("daily endpoint returns words from multiple shards in one streamed response", async () => {
  const idsByShard = new Map();
  for (const [id, shard] of Object.entries(manifest.wordShard)) {
    if (!idsByShard.has(shard)) idsByShard.set(shard, id);
    if (idsByShard.size === 2) break;
  }
  const wordIds = [...idsByShard.values()];
  const bucket = {
    get: async (key) => {
      if (key.endsWith("manifest.json")) return r2JsonObject(manifest);
      const match = /shard-(\d+)\.json$/u.exec(key);
      if (!match) return null;
      return r2JsonObject(JSON.parse(fs.readFileSync(path.join(versionRoot, `shard-${match[1]}.json`), "utf8")));
    },
  };
  const background = [];
  const response = await onRequestPost({
    request: new Request("https://example.test/api/books/cet6/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataVersion: pointer.dataVersion, planDay: 4, kind: "review", wordIds }),
    }),
    params: { book: "cet6" },
    env: { BOOKS: bucket },
    waitUntil: (promise) => background.push(promise),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  await Promise.all(background);
  assert.equal(body.dataVersion, pointer.dataVersion);
  assert.equal(body.wordCount, 2);
  assert.deepEqual(Object.keys(body.words).sort(), [...wordIds].sort());
});

test("long sentence segments merge trailing punctuation and contain no lone punctuation rows", () => {
  for (const shard of Object.keys(manifest.shards)) {
    const pack = JSON.parse(fs.readFileSync(path.join(versionRoot, `shard-${shard}.json`), "utf8"));
    for (const word of Object.values(pack.words)) {
      for (const item of word.longSentences ?? []) {
        for (const seg of item.segments ?? []) {
          const isLonePunctuation =
            !seg.role &&
            !seg.role_label &&
            !seg.gloss &&
            /^[.,!?;:…“”‘’—\s]+$/.test(seg.text);
          assert.equal(
            isLonePunctuation,
            false,
            `Word ${word.spelling} contains a lone punctuation segment: ${JSON.stringify(seg)}`,
          );
        }
      }
    }
  }
});
