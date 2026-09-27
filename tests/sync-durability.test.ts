import assert from "node:assert/strict";
import test from "node:test";
import { ProgressSync, type SyncAdapter } from "../src/sync-client.ts";
import { emptyProgress, rateSearchWord } from "../src/progress.ts";
import { mergeProgress } from "../src/sync-merge.ts";
import type { AppProgress } from "../src/types.ts";

function fixture(local: AppProgress | null = null) {
  const state = { local, cloud: emptyProgress(), revision: 0, online: true, status: "", visible: null as AppProgress | null, puts: 0 };
  const adapter: SyncAdapter = {
    read: async () => structuredClone(state.local),
    write: async (next) => { state.local = structuredClone(next); },
    change: (progress, status) => { state.visible = progress; state.status = status; },
    request: async (payload) => {
      if (!state.online) throw new Error("offline");
      if (payload && payload.revision !== state.revision) return { status: 409, data: { progress: structuredClone(state.cloud), revision: state.revision } };
      if (payload) {
        assert.equal(payload.progress.localSync, undefined, "device metadata must not enter the cloud");
        state.cloud = structuredClone(payload.progress); state.revision++; state.puts++;
      }
      return { status: 200, data: { progress: structuredClone(state.cloud), revision: state.revision } };
    },
  };
  return { state, adapter, sync: new ProgressSync(adapter) };
}

test('continuous successful uploads do not turn new in-flight ratings into exponential conflict backoff', async () => {
  const f = fixture(); await f.sync.open();
  const request = f.adapter.request;
  let additions = 5;
  f.adapter.request = async payload => {
    const response = await request(payload);
    if (payload && additions > 0) await f.sync.save(rateSearchWord(f.sync.progress, `during-${additions--}`, 'unclear'));
    return response;
  };
  await f.sync.save(rateSearchWord(f.sync.progress, 'first', 'mastered'));
  await f.sync.sync();
  assert.equal(f.state.puts, 5, 'one exchange remains bounded');
  assert.equal(f.state.local?.localSync?.pending, true);
  await f.sync.sync(false);
  assert.equal(f.state.puts, 6, 'successful batches must not block the next automatic attempt');
  assert.equal(Object.keys(f.state.cloud.words).length, 6);
  assert.equal(f.state.status, 'synced');
  f.sync.stop();
});

test('the last permitted successful response is acknowledged instead of being discarded', async () => {
  const f = fixture(); await f.sync.open();
  const request = f.adapter.request;
  let additions = 4;
  f.adapter.request = async payload => {
    const response = await request(payload);
    if (payload && additions > 0) await f.sync.save(rateSearchWord(f.sync.progress, `during-${additions--}`, 'unclear'));
    return response;
  };
  await f.sync.save(rateSearchWord(f.sync.progress, 'first', 'mastered'));
  await f.sync.sync();
  assert.equal(f.state.puts, 5);
  assert.equal(f.state.status, 'synced');
  assert.equal(f.state.local?.localSync?.pending, false);
  f.sync.stop();
});

test('native connectivity reports offline despite a WebView claiming to be online, then preserves and uploads pending data', async () => {
  const f = fixture();
  f.adapter.isOnline = () => f.state.online;
  await f.sync.open();
  f.state.online = false;
  await f.sync.save(rateSearchWord(f.sync.progress, 'w1', 'unclear'));
  await f.sync.sync();
  assert.equal(f.state.status, 'offline');
  assert.equal(f.state.local?.localSync?.pending, true);
  f.state.online = true;
  await f.sync.sync();
  assert.equal(f.state.status, 'synced');
  assert.equal(f.state.cloud.words.w1.proficiency, 'unclear');
  f.sync.stop();
});

test("unchanged polling skips re-saving snapshots but pending ratings still upload after 304", async () => {
  const f = fixture();
  let conditional = 0, writes = 0;
  const request = f.adapter.request, write = f.adapter.write;
  f.adapter.write = async value => { writes++; return write(value); };
  f.adapter.request = async (payload, revision) => {
    if (!payload && revision === f.state.revision) { conditional++; return { status: 304, data: {} as any }; }
    return request(payload);
  };
  await f.sync.open();
  const before = writes;
  await f.sync.sync();
  assert.equal(writes, before); assert.equal(conditional, 1);
  await f.sync.save(rateSearchWord(f.sync.progress, "w1", "mastered"));
  await f.sync.sync();
  assert.equal(f.state.cloud.words.w1.proficiency, "mastered");
  assert.equal(f.state.status, "synced");
  f.sync.stop();
});

test("new device stays in recovery on network failure, rejects edits, and later restores the cloud", async () => {
  const f = fixture(); f.state.cloud = rateSearchWord(emptyProgress(), "existing", "unclear"); f.state.revision = 1; f.state.online = false;
  await f.sync.open();
  assert.equal(f.state.visible, null);
  assert.equal(f.state.local, null);
  await assert.rejects(f.sync.save(rateSearchWord(emptyProgress(), "new", "mastered")), /恢复/);
  assert.equal(f.state.puts, 0);
  f.state.online = true; await f.sync.sync();
  assert.equal(f.state.visible?.words.existing.proficiency, "unclear");
  assert.equal(f.state.local?.localSync?.restored, true);
  assert.equal(f.state.puts, 0);
  f.sync.stop();
});

test("offline pending edits survive process restart and are cleared only after cloud acknowledgement", async () => {
  const f = fixture(); await f.sync.open(); f.state.online = false;
  await f.sync.save(rateSearchWord(f.sync.progress, "offline", "unmastered"));
  assert.deepEqual(f.state.local?.localSync, { restored: true, pending: true });
  f.sync.stop();
  const restarted = new ProgressSync(f.adapter); await restarted.open();
  assert.equal(f.state.visible?.words.offline.proficiency, "unmastered");
  assert.equal(f.state.local?.localSync?.pending, true);
  f.state.online = true; await restarted.sync();
  assert.equal(f.state.cloud.words.offline.proficiency, "unmastered");
  assert.deepEqual(f.state.local?.localSync, { restored: true, pending: false });
  restarted.stop();
});

test("cloud success with a lost response can be retried without re-counting events", async () => {
  const f = fixture(); await f.sync.open();
  const request = f.adapter.request;
  let lose = true;
  f.adapter.request = async (payload) => {
    const response = await request(payload);
    if (payload && lose) { lose = false; throw new Error("response lost"); }
    return response;
  };
  await f.sync.save(rateSearchWord(f.sync.progress, "w1", "unclear"));
  await f.sync.sync();
  assert.equal(f.state.local?.localSync?.pending, true);
  assert.equal(f.state.puts, 1);
  await f.sync.sync();
  assert.equal(f.state.puts, 1);
  assert.equal(f.state.status, "synced");
  assert.equal(f.state.local?.localSync?.pending, false);
  f.sync.stop();
});

test("ratings made during an upload stay pending when the next request fails", async () => {
  const f = fixture(); await f.sync.open();
  const request = f.adapter.request;
  let changed = false;
  f.adapter.request = async (payload) => {
    const response = await request(payload);
    if (payload && !changed) {
      changed = true;
      await f.sync.save(rateSearchWord(f.sync.progress, "later", "unclear"));
      f.state.online = false;
    }
    return response;
  };
  await f.sync.save(rateSearchWord(f.sync.progress, "first", "mastered"));
  await f.sync.sync();
  assert.ok(f.state.cloud.words.first);
  assert.equal(f.state.cloud.words.later, undefined);
  assert.ok(f.state.local?.words.later);
  assert.equal(f.state.local?.localSync?.pending, true);
  assert.notEqual(f.state.status, "synced");
  f.state.online = true; await f.sync.sync();
  assert.ok(f.state.cloud.words.later);
  assert.equal(f.state.local?.localSync?.pending, false);
  f.sync.stop();
});

test("clock-skewed offline concurrent ratings converge, and a later observed downgrade wins", async () => {
  const a = fixture(), b = fixture(); await a.sync.open(); await b.sync.open();
  a.state.online = b.state.online = false;
  const ax = rateSearchWord(a.sync.progress, "word", "mastered"); ax.words.word.lastSeenAt = "2099-01-01T00:00:00.000Z";
  const bx = rateSearchWord(b.sync.progress, "word", "unclear"); bx.words.word.lastSeenAt = "2000-01-01T00:00:00.000Z";
  await a.sync.save(ax); await b.sync.save(bx);
  const merged = mergeProgress(a.sync.progress, b.sync.progress);
  assert.deepEqual(merged, mergeProgress(b.sync.progress, a.sync.progress));
  const winner = a.sync.progress.words.word.ratingVersion!.actor > b.sync.progress.words.word.ratingVersion!.actor ? a : b;
  assert.equal(merged.words.word.proficiency, winner.sync.progress.words.word.proficiency);
  b.state.cloud = merged; b.state.revision = 1; b.state.online = true; await b.sync.sync();
  const next = rateSearchWord(b.sync.progress, "word", "unmastered"); next.words.word.lastSeenAt = "1990-01-01T00:00:00.000Z";
  await b.sync.save(next);
  assert.equal(b.sync.progress.words.word.ratingVersion?.counter, 2);
  assert.equal(mergeProgress(b.sync.progress, a.sync.progress).words.word.proficiency, "unmastered");
  a.sync.stop(); b.sync.stop();
});

test("invalid cloud cannot alter valid local records or become a successful first recovery", async () => {
  for (const initial of [null, rateSearchWord(emptyProgress(), "safe", "unclear")]) {
    const f = fixture(initial);
    f.adapter.request = async () => ({ status: 200, data: { revision: 1, progress: { version: 2, words: {} } as AppProgress } });
    await f.sync.open();
    assert.equal(f.state.status, "error");
    assert.deepEqual(f.state.local, initial);
    assert.equal(f.state.puts, 0);
    f.sync.stop();
  }
});

test("usable local progress is exposed before a slow cloud request finishes", async () => {
  const f = fixture(rateSearchWord(emptyProgress(), "saved", "unclear"));
  let finish!: (response: Awaited<ReturnType<SyncAdapter["request"]>>) => void;
  f.adapter.request = () => new Promise((resolve) => { finish = resolve; });
  const opening = f.sync.open(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.state.visible?.words.saved.proficiency, "unclear");
  f.sync.stop(); finish({ status: 200, data: { revision: 0, progress: emptyProgress() } }); await opening;
});
