import assert from "node:assert/strict";
import test from "node:test";
import { createKeyValueProgressStore } from "../src/key-value-progress.ts";
import { validProgress } from "../src/progress-validation.ts";
import { emptyProgress, rateSearchWord } from "../src/progress.ts";
import { ProgressSync } from "../src/sync-client.ts";
import { encodeProgressWire, decodeProgressWire } from "../src/progress-compression.ts";
import { fullProgressFixture } from "./full-progress-fixture.ts";
import { progressCatalog } from "../website/server/progress-curriculum.ts";

function fixture() {
  const entries = new Map<string, string>();
  let fail = false;
  const adapter = { get: async (key: string) => entries.get(key) ?? null, put: async (key: string, value: string, backup?: string) => {
    if (fail) throw new Error("storage full");
    if (backup !== undefined) entries.set(`${key}:backup`, backup);
    entries.set(key, value);
  } };
  return { entries, adapter, fail: (value: boolean) => { fail = value; }, store: () => createKeyValueProgressStore("cyword-progress:isolated", adapter, validProgress) };
}
test("key-value store serializes snapshots, recovers and preserves damaged bytes across restart", async () => {
  const f = fixture(), store = f.store();
  const first = rateSearchWord(emptyProgress(), "one", "unclear"), second = rateSearchWord(first, "two", "mastered");
  await Promise.all([store.write(first), store.write(second)]);
  assert.deepEqual(await store.read(), second);
  f.entries.set("cyword-progress:isolated", "{truncated");
  const recovered = await f.store().read();
  assert.deepEqual((recovered as typeof first).words, first.words);
  assert.equal((recovered as typeof first).localSync?.recovered, true);
  assert.equal([...f.entries].find(([key]) => key.includes(":corrupt:"))?.[1], "{truncated");
  assert.deepEqual(await f.store().read(), recovered);
});
test("failed preservation or write cannot replace the primary with empty or unconfirmed progress", async () => {
  const f = fixture(), store = f.store(), first = rateSearchWord(emptyProgress(), "one", "unclear");
  await store.write(first); f.fail(true);
  await assert.rejects(store.write(rateSearchWord(first, "two", "mastered")));
  assert.deepEqual(await store.read(), first);
  f.entries.set("cyword-progress:isolated", "null");
  await assert.rejects(f.store().read());
  assert.equal(f.entries.get("cyword-progress:isolated"), "null");
});
test("corrupt native-style storage can recover valid cloud data, preserving account isolation", async () => {
  const f = fixture(), store = f.store(), remote = rateSearchWord(emptyProgress(), "one", "unclear");
  f.entries.set("cyword-progress:isolated", "null");
  f.entries.set("cyword-progress:other", "other-account-bytes");
  let puts = 0;
  const sync = new ProgressSync({ read: store.read, write: store.write, change() {}, request: async payload => { if (payload) puts++; return { status: 200, data: { revision: 4, progress: remote } }; } });
  await sync.open();
  assert.equal(puts, 0); assert.deepEqual(sync.progress.words, remote.words);
  assert.equal((await sync.flush()).cloudSynced, true);
  assert.equal(f.entries.get("cyword-progress:other"), "other-account-bytes");
  assert.equal([...f.entries].find(([key]) => key.includes(":corrupt:"))?.[1], "null");
  sync.stop();
});

test("complete-book primary and recovery copy fit the browser storage budget and survive restart", async () => {
  const f = fixture(), key = "cyword-progress:isolated";
  const make = () => createKeyValueProgressStore(key, f.adapter, validProgress, { encode: encodeProgressWire, decode: decodeProgressWire });
  const progress = fullProgressFixture(progressCatalog), store = make();
  await store.write(progress);
  await store.write(rateSearchWord(progress, Object.keys(progress.words)[0], "mastered"));
  const bytes = [...f.entries].reduce((sum, [key, value]) => sum + (key.length + value.length) * 2, 0);
  assert.ok(bytes < 5 * 1024 * 1024, `primary and backup used ${bytes} bytes`);
  assert.equal(Object.keys(((await make().read()) as typeof progress).words).length, 5166);
});
