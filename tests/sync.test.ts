import assert from "node:assert/strict";
import test from "node:test";
import { emptyProgress, rateStudyWord, startReviewDay, rateReviewWord, reconcileCompletion } from "../src/progress.ts";
import { mergeProgress } from "../src/sync-merge.ts";
import { ProgressSync } from "../src/sync-client.ts";
import { validProgress, packProgress, unpackProgress } from "../website/server/progress-sync.ts";
import type { AppProgress, Catalog, PlanDay, StudyGroup } from "../src/types.ts";

const group: StudyGroup = { id: "root:a", kind: "root", rootId: "a", spelling: "a", meaning: "", memoryMethod: "", wordIds: ["w1", "w2"], wordCount: 2, firstOrder: 1 };
const plan: PlanDay = { day: 1, kind: "study", groupIds: [group.id], appearanceCount: 2, uniqueWordCount: 2 };
const learned = (word: string, time: string) => {
  const result = rateStudyWord(emptyProgress(), plan, group, word, "unclear");
  result.words[word].learnedAt = time; result.words[word].lastSeenAt = time;
  result.planDays["1"].startedAt = time;
  return result;
};
const one = () => learned("w1", "2026-09-17T00:00:00.000Z");
const two = () => learned("w2", "2026-09-17T00:01:00.000Z");

test("concurrent progress merges commutatively and idempotently, completing shared groups", () => {
  const merged = mergeProgress(one(), two());
  assert.deepEqual(merged, mergeProgress(two(), one()));
  assert.deepEqual(merged, mergeProgress(merged, merged));
  const catalog = { groups: [group], schedule: [{ day: 1, groupIds: [group.id], appearanceCount: 2, uniqueWordCount: 2 }] } as Catalog;
  const reconciled = reconcileCompletion(merged, catalog);
  assert.ok(reconciled.planDays["1"].completedAt);
  assert.deepEqual(reconciled.planDays["1"].completedGroupIds, [group.id]);
});

test("newer ratings win and removed bookmarks cannot reappear from stale devices", () => {
  const stale = one(); stale.bookmarks.w1 = "2026-09-17T00:00:00.000Z";
  const current = one(); current.words.w1.lastSeenAt = "2026-09-17T01:00:00.000Z"; current.words.w1.proficiency = "mastered";
  current.bookmarkChanges = { w1: { at: "2026-09-17T01:00:00.000Z", saved: false } };
  const merged = mergeProgress(stale, current);
  assert.equal(merged.words.w1.proficiency, "mastered"); assert.equal(merged.bookmarks.w1, undefined);
  assert.equal(mergeProgress(merged, stale).bookmarks.w1, undefined);
});

test("review merging preserves priority order, combines completion, and deduplicates history", () => {
  const started = startReviewDay(mergeProgress(one(), two()), 4, ["w2", "w1"], true);
  const a = rateReviewWord(started, 4, "w2", "mastered");
  const b = rateReviewWord(started, 4, "w1", "unmastered");
  const merged = mergeProgress(a, b);
  assert.deepEqual(merged.planDays["4"].reviewWordIds, ["w2", "w1"]);
  assert.ok(merged.planDays["4"].completedAt);
  assert.equal(mergeProgress(merged, a).reviewHistory.length, 2);
});

test("sync retries revision conflicts without discarding either device's edits", async () => {
  let cloud = emptyProgress(), revision = 0, raced = false;
  const statuses: string[] = [];
  const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: (_, status) => statuses.push(status), request: async (input) => {
    if (input && !raced) { cloud = two(); revision = 1; raced = true; }
    if (input && input.revision !== revision) return { status: 409, data: { revision, progress: cloud } };
    if (input) { cloud = input.progress; revision++; }
    return { status: 200, data: { revision, progress: structuredClone(cloud) } };
  } });
  await sync.open();
  assert.deepEqual(Object.keys(cloud.words), ["w1", "w2"]);
  assert.equal(statuses.at(-1), "synced"); sync.stop();
});

test("edits made while an upload is in flight are also uploaded", async () => {
  let cloud = emptyProgress(), revision = 0, changed = false;
  const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: () => {}, request: async (input) => {
    if (input) {
      cloud = input.progress; revision++;
      if (!changed) { changed = true; await sync.save(mergeProgress(sync.progress, two())); }
    }
    return { status: 200, data: { revision, progress: structuredClone(cloud) } };
  } });
  await sync.open(); assert.equal(Object.keys(cloud.words).length, 2); sync.stop();
});

test("network failure keeps local data; stopping an account discards late responses", async () => {
  let status = "";
  const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: (_, s) => { status = s; }, request: async () => { throw new Error("offline"); } });
  await sync.open(); assert.equal(status, "error"); assert.ok(sync.progress.words.w1); sync.stop();
  let resolve!: (value: { status: number; data: { revision: number; progress: AppProgress } }) => void;
  let changes = 0;
  const delayed = new ProgressSync({ read: async () => one(), write: async () => { changes++; }, change: () => {}, request: () => new Promise((r) => { resolve = r; }) });
  const opening = delayed.open(); await new Promise((r) => setTimeout(r, 0)); delayed.stop(); resolve({ status: 200, data: { revision: 1, progress: two() } }); await opening;
  assert.equal(changes, 0);
});

test("server rejects malformed snapshots and compressed data round-trips", async () => {
  const valid = mergeProgress(one(), two());
  assert.equal(validProgress(valid), true);
  assert.equal(validProgress({ ...valid, words: { w1: { proficiency: "unknown" } } }), false);
  assert.equal(validProgress({ ...valid, planDays: { 1: { ...valid.planDays["1"], ratedExposureKeys: "bad" } } }), false);
  assert.deepEqual(await unpackProgress(await packProgress(valid)), valid);
});

test("expired sessions stop syncing and retain locally saved learning records", async () => {
  for (const expireOn of [1, 2, 6]) {
    let calls = 0, expired = 0;
    let local = one();
    const sync = new ProgressSync({
      read: async () => local,
      write: async (value) => { local = structuredClone(value); },
      change: () => {},
      unauthorized: () => { expired++; },
      request: async () => ({ status: ++calls === expireOn ? 401 : calls === 1 ? 200 : 409, data: { revision: calls, progress: emptyProgress(), error: "登录已过期" } }),
    });
    await sync.open();
    assert.equal(expired, 1);
    assert.ok(local.words.w1);
    await sync.sync();
    assert.equal(calls, expireOn, "expired token must not keep retrying");
    await assert.rejects(sync.save(two()), /账号已切换/);
  }
});

test("network and service errors do not log out an account; late 401 cannot log out its replacement", async () => {
  let expired = 0;
  for (const status of [403, 500, 503]) {
    const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: () => {}, unauthorized: () => { expired++; }, request: async () => ({ status, data: { revision: 0, progress: emptyProgress() } }) });
    await sync.open();
    assert.ok(sync.progress.words.w1);
    sync.stop();
  }
  let resolve!: (value: { status: number; data: { revision: number; progress: AppProgress } }) => void;
  const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: () => {}, unauthorized: () => { expired++; }, request: () => new Promise((done) => { resolve = done; }) });
  const opening = sync.open();
  await new Promise((done) => setTimeout(done, 0));
  sync.stop();
  resolve({ status: 401, data: { revision: 0, progress: emptyProgress() } });
  await opening;
  assert.equal(expired, 0);
});

test("failed local saves never publish or upload unpersisted ratings, even after reconnect", async () => {
  let cloud = emptyProgress(), disk = emptyProgress(), failing = false, revision = 0;
  const announced: AppProgress[] = [];
  const sync = new ProgressSync({
    read: async () => disk,
    write: async (next) => { if (failing) throw new Error("disk full"); disk = structuredClone(next); },
    change: (progress) => announced.push(structuredClone(progress)),
    request: async (payload) => { if (payload) { cloud = structuredClone(payload.progress); revision++; } return { status: 200, data: { revision, progress: cloud } }; },
  });
  await sync.open();
  failing = true;
  await assert.rejects(sync.save(one()), /disk full/);
  assert.equal(sync.progress.words.w1, undefined);
  assert.equal(announced.some((progress) => Boolean(progress.words.w1)), false);
  failing = false;
  await sync.sync();
  assert.equal(cloud.words.w1, undefined);
  assert.equal(disk.words.w1, undefined);
  const failed = await sync.flush();
  assert.equal(failed.localSaved, false);
  assert.equal(failed.cloudSynced, false);
  await sync.save(one());
  const recovered = await sync.flush();
  assert.equal(recovered.localSaved, true);
  assert.equal(recovered.cloudSynced, true);
  assert.equal(cloud.words.w1.proficiency, "unclear");
  sync.stop();
});

test("flush distinguishes durable offline progress, unsaved progress, and cloud conflicts", async () => {
  let failWrite = false;
  const sync = new ProgressSync({ read: async () => one(), write: async () => !failWrite, change: () => {}, request: async () => { throw new Error("offline"); } });
  await sync.open();
  await sync.save(two());
  assert.deepEqual(await sync.flush(), { localSaved: true, cloudSynced: false, message: "offline" });
  failWrite = true;
  const changed = structuredClone(sync.progress); changed.words.w1.proficiency = "mastered";
  await assert.rejects(sync.save(changed), /设备拒绝/);
  assert.equal((await sync.flush()).localSaved, false);
  sync.stop();
  const busy = new ProgressSync({ read: async () => one(), write: async () => {}, change: () => {}, request: async () => ({ status: 409, data: { revision: 1, progress: emptyProgress() } }) });
  await busy.open();
  assert.deepEqual(await busy.flush(), { localSaved: true, cloudSynced: false, message: "设备正在同时学习，稍后继续同步" });
  busy.stop();
});

test("a slower device uses a monotonic rating time after observing a faster device", async () => {
  const future = one();
  future.words.w1.lastSeenAt = "2035-01-01T00:00:00.000Z";
  let cloud = future, revision = 1;
  const sync = new ProgressSync({ read: async () => null, write: async () => {}, change: () => {}, request: async (payload) => {
    if (payload) { cloud = structuredClone(payload.progress); revision++; }
    return { status: 200, data: { revision, progress: structuredClone(cloud) } };
  } });
  await sync.open();
  const next = structuredClone(sync.progress);
  next.words.w1.proficiency = "mastered";
  next.words.w1.lastSeenAt = "2026-09-20T00:00:00.000Z";
  await sync.save(next);
  assert.equal(sync.progress.words.w1.lastSeenAt, "2035-01-01T00:00:00.001Z");
  assert.equal((await sync.flush()).cloudSynced, true);
  assert.equal(cloud.words.w1.proficiency, "mastered");
  assert.equal(cloud.words.w1.learnedAt, future.words.w1.learnedAt);
  const laterRemote = structuredClone(cloud);
  laterRemote.words.w1.lastSeenAt = "2036-01-01T00:00:00.000Z";
  laterRemote.words.w1.proficiency = "unclear";
  cloud = laterRemote;
  await sync.sync();
  const reassessed = structuredClone(sync.progress);
  reassessed.words.w1.proficiency = "unmastered";
  reassessed.words.w1.lastSeenAt = "2026-09-20T00:00:01.000Z";
  await sync.save(reassessed);
  assert.equal(sync.progress.words.w1.lastSeenAt, "2036-01-01T00:00:00.001Z");
  assert.equal(mergeProgress(sync.progress, future).words.w1.proficiency, "unmastered");
  assert.equal(validProgress(sync.progress), true);
  sync.stop();
});

test("new and released timestamp-only clients select the same winner for skewed and concurrent ratings", () => {
  // Released clients compare lastSeenAt, breaking equal timestamps by serialized value.
  const legacyWinner = (a: AppProgress, b: AppProgress) => {
    const x = a.words.w1, y = b.words.w1;
    const compare = x.lastSeenAt.localeCompare(y.lastSeenAt);
    return compare > 0 || (compare === 0 && JSON.stringify(x) >= JSON.stringify(y)) ? x : y;
  };
  for (const [aTime, bTime] of [
    ["2035-01-01T00:00:00.000Z", "2035-01-01T00:00:00.001Z"],
    ["2035-01-01T00:00:00.000Z", "2026-09-20T00:00:00.000Z"],
    ["2035-01-01T00:00:00.000Z", "2035-01-01T00:00:00.000Z"],
  ]) {
    const a = one(), b = one();
    a.words.w1.lastSeenAt = aTime; a.words.w1.proficiency = "mastered";
    b.words.w1.lastSeenAt = bTime; b.words.w1.proficiency = "unmastered";
    const expected = legacyWinner(a, b);
    const merged = mergeProgress(a, b);
    assert.equal(merged.words.w1.proficiency, expected.proficiency);
    assert.equal(merged.words.w1.lastSeenAt, expected.lastSeenAt);
    assert.deepEqual(merged, mergeProgress(b, a));
    assert.equal(legacyWinner(merged, a).proficiency, expected.proficiency);
    assert.equal(legacyWinner(merged, b).proficiency, expected.proficiency);
  }
});

test("a rating based on an earlier render does not re-rate unrelated words updated by sync", async () => {
  let cloud = mergeProgress(one(), two()), revision = 1;
  const sync = new ProgressSync({ read: async () => cloud, write: async () => {}, change: () => {}, request: async (payload) => {
    if (payload) { cloud = structuredClone(payload.progress); revision++; }
    return { status: 200, data: { revision, progress: structuredClone(cloud) } };
  } });
  await sync.open();
  const rendered = structuredClone(sync.progress);
  cloud.words.w2.proficiency = "mastered";
  cloud.words.w2.lastSeenAt = "2035-01-01T00:00:00.000Z";
  await sync.sync();
  const next = structuredClone(rendered); next.words.w1.proficiency = "mastered";
  await sync.save(next, rendered);
  assert.equal(sync.progress.words.w1.lastSeenAt, "2026-09-17T00:00:00.001Z");
  assert.equal(sync.progress.words.w2.lastSeenAt, "2035-01-01T00:00:00.000Z");
  assert.equal(sync.progress.words.w2.proficiency, "mastered");
  sync.stop();
});

// A fast local clock need not be rewritten if it already follows the observed rating.
test("a faster device preserves a new rating time ahead of the observed snapshot", async () => {
  const sync = new ProgressSync({ read: async () => one(), write: async () => {}, change: () => {}, request: async () => { throw new Error("offline"); } });
  await sync.open();
  const next = structuredClone(sync.progress);
  next.words.w1.proficiency = "mastered";
  next.words.w1.lastSeenAt = "2035-01-01T00:00:00.000Z";
  await sync.save(next);
  assert.equal(sync.progress.words.w1.lastSeenAt, next.words.w1.lastSeenAt);
  assert.equal(sync.progress.words.w1.proficiency, "mastered");
  sync.stop();
});
