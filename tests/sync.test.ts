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
