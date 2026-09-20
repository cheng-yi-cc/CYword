import assert from "node:assert/strict";
import test from "node:test";
import { WordResourceCache } from "../src/word-resources.ts";
import type { WordDetail, WordsRequest } from "../src/types.ts";

const word = (id: string) => ({ id, bookCode: "cet6" } as WordDetail);
const response = (ids: string[], version = "v1") => ({ dataVersion: version, wordCount: ids.length, words: Object.fromEntries(ids.map(id => [id, word(id)])) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("overlapping foreground and prefetch loads share each in-flight word", async () => {
  const first = deferred<ReturnType<typeof response>>(), calls: WordsRequest[] = [];
  const cache = new WordResourceCache({ bookCode: "cet6", dataVersion: "v1", request: async request => {
    calls.push(request); return request.wordIds.includes("a") ? first.promise : response(request.wordIds);
  } });
  const a = cache.load(["a"], "study", 1);
  const ab = cache.load(["a", "b", "a"], "bookmarks", 1);
  await Promise.resolve();
  assert.deepEqual(calls.map(call => call.wordIds), [["a"], ["b"]]);
  first.resolve(response(["a"]));
  assert.deepEqual(await Promise.all([a, ab]), [true, true]);
  await cache.load(["a"], "review", 4);
  assert.equal(calls.length, 2, "a new page and kind reuse the same versioned cache");
});

test("failed and incomplete loads are retryable and never publish a partial word", async () => {
  let calls = 0;
  const cache = new WordResourceCache({ bookCode: "cet6", dataVersion: "v1", request: async request => {
    if (++calls === 1) throw new Error("offline");
    if (calls === 2) return response(["a"]);
    return response(request.wordIds);
  } });
  assert.equal(await cache.load(["a", "b"], "study", 1), false);
  assert.equal(await cache.load(["a", "b"], "study", 1), false);
  assert.deepEqual(cache.snapshot(), {});
  assert.equal(await cache.load(["a", "b"], "study", 1), true);
  assert.equal(Object.keys(cache.snapshot()).length, 2);
});

test("a superseded response cannot repopulate a cleared cache", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  const cache = new WordResourceCache({ bookCode: "cet6", dataVersion: "v1", request: () => pending.promise });
  const load = cache.load(["a"], "study", 1);
  cache.clear();
  pending.resolve(response(["a"]));
  assert.equal(await load, false);
  assert.deepEqual(cache.snapshot(), {});
});

test("bounded LRU retains recently viewed words and rejects another book or version", async () => {
  const cache = new WordResourceCache({ bookCode: "cet6", dataVersion: "v1", capacity: 2, request: async request => response(request.wordIds) });
  await cache.load(["a", "b"], "study", 1);
  await cache.load(["a"], "bookmarks", 1);
  await cache.load(["c"], "study", 1);
  assert.deepEqual(Object.keys(cache.snapshot()), ["a", "c"]);
  const wrongVersion = new WordResourceCache({ bookCode: "cet6", dataVersion: "v2", request: async () => response(["a"]) });
  assert.equal(await wrongVersion.load(["a"], "study", 1), false);
  const wrongBook = new WordResourceCache({ bookCode: "cet4", dataVersion: "v1", request: async () => response(["a"]) });
  assert.equal(await wrongBook.load(["a"], "study", 1), false);
});
