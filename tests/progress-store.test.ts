import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { emptyProgress, rateSearchWord } from "../src/progress.ts";
import { validProgress } from "../src/progress-validation.ts";
import { ProgressSync } from "../src/sync-client.ts";
const { createProgressStore } = createRequire(import.meta.url)("../electron/progress-store.cjs");

test("desktop storage serializes durable writes and recovers a valid previous copy without discarding corrupt bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cyword-progress-recovery-"));
  const target = path.join(directory, "progress.json"), store = createProgressStore(target, validProgress);
  assert.equal(await store.read(), null);
  const first = rateSearchWord(emptyProgress(), "one", "unclear");
  const second = rateSearchWord(first, "two", "mastered");
  await Promise.all([store.write(first), store.write(second)]);
  await store.drain();
  assert.deepEqual(await store.read(), second);
  assert.deepEqual(JSON.parse(await readFile(`${target}.backup`, "utf8")), first);
  await writeFile(target, '{"version":2,"words":');
  const recovered = await store.read();
  assert.deepEqual(recovered.words, first.words);
  assert.equal(recovered.localSync.recovered, true);
  const copies = (await readdir(directory)).filter(name => name.includes(".corrupt-"));
  assert.equal(copies.length, 1);
  assert.equal(await readFile(path.join(directory, copies[0]), "utf8"), '{"version":2,"words":');
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), recovered);
});

test("corrupt progress without a backup cannot become an empty user or be uploaded", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cyword-progress-no-backup-"));
  const target = path.join(directory, "progress.json");
  await writeFile(target, "null");
  const store = createProgressStore(target, validProgress);
  let puts = 0, writes = 0;
  const sync = new ProgressSync({ read: () => store.read(), write: async value => { writes++; return store.write(value); }, change: () => {},
    reconcile: value => ({ ...value, bookmarkChanges: {} }),
    request: async body => { if (body) puts++; return { status: 200, data: { revision: 0, progress: emptyProgress() } }; } });
  await sync.open();
  assert.equal(writes, 0); assert.equal(puts, 0);
  assert.equal(await readFile(target, "utf8"), "null");
  assert.equal((await sync.flush()).localSaved, false);
  sync.stop();
});

test("desktop write failure leaves the previous primary intact and blocks draining until retry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cyword-progress-fail-"));
  const target = path.join(directory, "progress.json"), store = createProgressStore(target, validProgress);
  const first = rateSearchWord(emptyProgress(), "one", "unclear");
  await writeFile(target, JSON.stringify(first));
  // A directory at the exact backup path is an isolated, reproducible I/O failure.
  await mkdir(`${target}.backup`);
  await assert.rejects(store.write(rateSearchWord(first, "two", "mastered")));
  await assert.rejects(store.drain());
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), first);
});
