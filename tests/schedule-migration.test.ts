import assert from "node:assert/strict";
import test from "node:test";
import { emptyProgress, reconcileCompletion, rateStudyWord, startReviewDay, rateReviewWord } from "../src/progress.ts";
import { mergeProgress } from "../src/sync-merge.ts";
import { ProgressSync } from "../src/sync-client.ts";
import type { Catalog, PlanDay, StudyGroup } from "../src/types.ts";

const group = (id: string, wordIds: string[]): StudyGroup => ({ id, wordIds, wordCount: wordIds.length, kind: "root", rootId: id, spelling: id, meaning: "", memoryMethod: "", firstOrder: 0 });
const a = group("root:a", ["w1", "w2"]), b = group("root:b", ["w1", "w3"]), c = group("solo:c", ["w4"]);
const plan = (day: number, groups: StudyGroup[]): PlanDay => ({ day, kind: "study", groupIds: groups.map(g => g.id), appearanceCount: groups.reduce((n, g) => n + g.wordCount, 0), uniqueWordCount: new Set(groups.flatMap(g => g.wordIds)).size });
const catalog = { groups: [a, b, c], schedule: [plan(1, [c]), plan(2, [b]), plan(3, [a])] } as Catalog;
function oldProgress() {
  let progress = rateStudyWord(emptyProgress(), plan(1, [a]), a, "w1", "mastered");
  progress = rateStudyWord(progress, plan(1, [a]), a, "w2", "unclear");
  progress = rateStudyWord(progress, plan(2, [b, c]), c, "w4", "unmastered");
  progress = startReviewDay(progress, 4, ["w2", "w4"], true);
  return rateReviewWord(progress, 4, "w2", "unclear");
}

test("moving study days preserves ratings and review sessions, and credits only completed group exposures", () => {
  const old = oldProgress(), snapshot = structuredClone(old), next = reconcileCompletion(old, catalog);
  assert.deepEqual(next.words, old.words);
  assert.deepEqual(next.reviewHistory, old.reviewHistory);
  assert.deepEqual(next.planDays[4], old.planDays[4]);
  assert.deepEqual(next.planDays[1].ratedExposureKeys, ["solo:c:w4"]);
  assert.deepEqual(next.planDays[3].ratedExposureKeys, ["root:a:w1", "root:a:w2"]);
  assert.ok(next.planDays[1].completedAt && next.planDays[3].completedAt);
  assert.equal(next.planDays[2], undefined, "w1 in another root still needs its own exposure");
  assert.deepEqual(reconcileCompletion(next, catalog), next);
  assert.deepEqual(old, snapshot, "migration does not mutate its input");
});

test("stale day completion cannot finish a different day, and old devices cannot double count moved exposures", () => {
  const old = oldProgress();
  old.planDays[1].startedAt = "2026-09-01T10:00:00.000Z";
  old.planDays[2].startedAt = "2026-09-02T10:00:00.000Z";
  const expanded = { ...catalog, schedule: [plan(1, [a, c]), plan(2, [b])] } as Catalog;
  const partial = structuredClone(old); delete partial.planDays[2];
  const next = reconcileCompletion(partial, expanded);
  assert.equal(next.planDays[1].completedAt, undefined);
  const migrated = reconcileCompletion(old, catalog);
  const merged = reconcileCompletion(mergeProgress(migrated, old), catalog);
  assert.equal(merged.words.w1.exposures, 1);
  // 同一天编号的旧记录合并时保留较早开始时间；迁移完成情况不应因此改变。
  const expectedDays = structuredClone(migrated.planDays);
  expectedDays[1].startedAt = old.planDays[1].startedAt;
  assert.deepEqual(merged.planDays, expectedDays);
  assert.deepEqual(reconcileCompletion(mergeProgress(merged, old), catalog), merged);
});

test("local progress migrates even when sync is unavailable", async () => {
  const sync = new ProgressSync({ read: async () => oldProgress(), write: async () => {}, request: async () => { throw new Error("offline"); }, change: () => {}, reconcile: progress => reconcileCompletion(progress, catalog) });
  await sync.open();
  assert.deepEqual(sync.progress.planDays[3].ratedExposureKeys, ["root:a:w1", "root:a:w2"]);
  sync.stop();
});

test("a migrated snapshot converges when the cloud still uses the previous day layout", async () => {
  let cloud = oldProgress(), revision = 1, puts = 0, status = "";
  const sync = new ProgressSync({ read: async () => oldProgress(), write: async () => {}, change: (_, value) => { status = value; },
    reconcile: progress => reconcileCompletion(progress, catalog), request: async input => {
      if (input) { cloud = input.progress; revision++; puts++; }
      return { status: 200, data: { revision, progress: structuredClone(cloud) } };
    } });
  await sync.open();
  assert.equal(status, "synced");
  assert.equal(puts, 1);
  assert.equal(cloud.words.w1.exposures, 1);
  sync.stop();
});
