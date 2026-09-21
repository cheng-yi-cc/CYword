import assert from "node:assert/strict";
import test from "node:test";
import { ProgressSync, type SyncAdapter } from "../src/sync-client.ts";
import { emptyProgress } from "../src/progress.ts";
import type { AppProgress } from "../src/types.ts";

function rated(id: string, time = "2026-09-21T00:00:00.000Z") {
  const result = emptyProgress();
  result.words[id] = { learnedAt: time, lastSeenAt: time, proficiency: "unclear", reviewCount: 0, exposures: 0 };
  return result;
}
function fixture() {
  const state = { local: rated("local"), remote: rated("cloud"), imported: false, reads: 0, writes: 0, failed: false, status: "", message: "", expire: false };
  const adapter: SyncAdapter = {
    mode: "local", read: async () => structuredClone(state.local),
    write: async value => { if (state.failed) throw Error("disk full"); state.local = structuredClone(value); },
    readImport: async () => state.imported,
    finishImport: async () => { state.imported = true; return true; },
    request: async payload => { if (payload) state.writes++; else state.reads++; return { status: state.expire ? 401 : 200, data: { revision: 1, progress: structuredClone(state.remote) } }; },
    change: (_, status, message) => { state.status = status; state.message = message; },
    unauthorized: () => { throw Error("local learning must not log out"); },
  };
  return { state, adapter, sync: new ProgressSync(adapter) };
}
test("local mode imports once per account, persists merged data before marking, and never uploads", async () => {
  const f = fixture(); await f.sync.open();
  assert.deepEqual(Object.keys(f.state.local.words).sort(), ["cloud", "local"]);
  assert.equal(f.state.imported, true); assert.equal(f.state.reads, 1);
  await f.sync.save(rated("new")); await f.sync.sync();
  assert.deepEqual(await f.sync.flush(), { localSaved: true, cloudSynced: false, message: "进度已保存在本机" });
  f.sync.stop();
  const reopened = new ProgressSync(f.adapter); await reopened.open(); await reopened.sync();
  assert.equal(f.state.reads, 1); assert.equal(f.state.writes, 0); reopened.stop();
});
test("failed import persistence leaves the completion marker unset and retries safely", async () => {
  const f = fixture(); f.state.failed = true; await f.sync.open();
  assert.equal(f.state.imported, false); assert.equal(f.state.local.words.cloud, undefined);
  f.state.failed = false; await f.sync.sync();
  assert.equal(f.state.imported, true); assert.ok(f.state.local.words.cloud); assert.equal(f.state.writes, 0); f.sync.stop();
});
test("offline or expired migration keeps local learning and logout usable without an upload", async () => {
  for (const expired of [false, true]) {
    const f = fixture(); f.state.expire = expired;
    if (!expired) f.adapter.request = async () => { throw Error("offline"); };
    await f.sync.open(); await f.sync.save(rated("new"));
    assert.equal(f.state.imported, false); assert.ok(f.state.local.words.new);
    assert.equal((await f.sync.flush()).localSaved, true); assert.equal(f.state.status, "pending");
    assert.equal(f.state.writes, 0); f.sync.stop();
  }
});
test("late legacy response merges with a saved rating and cannot overwrite it or another account", async () => {
  const f = fixture(); let resolve!: (value: Awaited<ReturnType<SyncAdapter["request"]>>) => void;
  f.adapter.request = () => new Promise(done => { resolve = done; });
  const opening = f.sync.open(); await new Promise(done => setTimeout(done, 0));
  await f.sync.save(rated("cloud", "2026-09-22T00:00:00.000Z"));
  resolve({ status: 200, data: { revision: 1, progress: f.state.remote } }); await opening;
  assert.equal(f.state.local.words.cloud.lastSeenAt, "2026-09-22T00:00:00.000Z");
  f.sync.stop();
  const g = fixture(); g.adapter.request = () => new Promise(done => { resolve = done; });
  const pending = g.sync.open(); await new Promise(done => setTimeout(done, 0)); g.sync.stop();
  resolve({ status: 200, data: { revision: 1, progress: rated("other") } }); await pending;
  assert.equal(g.state.imported, false); assert.equal(g.state.local.words.other, undefined);
});
test("local write failure never publishes a rating and blocks logout until saved", async () => {
  const f = fixture(); await f.sync.open(); f.state.failed = true;
  await assert.rejects(f.sync.save(rated("failed")), /disk full/);
  assert.equal(f.state.local.words.failed, undefined); assert.equal(f.sync.progress.words.failed, undefined);
  assert.equal((await f.sync.flush()).localSaved, false); assert.equal(f.state.writes, 0);
  f.state.failed = false; await f.sync.save(rated("retry")); assert.equal((await f.sync.flush()).localSaved, true); f.sync.stop();
});
