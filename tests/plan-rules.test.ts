import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, emptyProgress, currentPlanDayNumber, isPlanDayComplete, reviewAccess, rateSearchWord,
  startReviewDay, rateReviewWord, reconcileCompletion, planDayFraction } from "../src/progress.ts";
import { mergeProgress } from "../src/sync-merge.ts";
import type { Catalog, Proficiency } from "../src/types.ts";

const catalog = {
  book: { code: "fixture" }, dataVersion: "v1",
  groups: Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, wordIds: [`w${i}`] })),
  schedule: Array.from({ length: 6 }, (_, i) => ({ day: i + 1, groupIds: [`g${i}`], appearanceCount: 1, uniqueWordCount: 1 })),
} as Catalog;
const plan = buildPlan(catalog);
const learned = (n: number, level: Proficiency = "unclear") => {
  let result = emptyProgress();
  for (let i = 0; i < n; i++) result = rateSearchWord(result, `w${i}`, level);
  return result;
};

test("one missing or invalid rating blocks all review mutations, including empty confirmation", () => {
  for (const invalid of [undefined, null, "", "invalid"]) {
    const progress = learned(3);
    (progress.words.w2 as any).proficiency = invalid;
    const snapshot = structuredClone(progress);
    assert.match(reviewAccess(progress, plan, 4).reason, /Day 3 还有 1 个单词未标记/);
    assert.throws(() => startReviewDay(progress, plan, 4, true, true), /请先完成/);
    assert.throws(() => rateReviewWord(progress, plan, 4, "w0", "mastered"), /请先完成/);
    assert.deepEqual(progress, snapshot);
    assert.equal(reconcileCompletion(progress, catalog).planDays[3], undefined);
  }
});

test("all three ratings unlock reviews, but later learning cannot skip an earlier review", () => {
  let progress = learned(6, "unmastered");
  progress = rateSearchWord(progress, "w1", "unclear");
  progress = rateSearchWord(progress, "w2", "mastered");
  assert.equal(reviewAccess(progress, plan, 4).allowed, true);
  assert.match(reviewAccess(progress, plan, 8).reason, /Day 4/);
  progress = startReviewDay(progress, plan, 4, true);
  assert.deepEqual(progress.planDays[4].reviewWordIds, ["w0", "w1"]);
  progress = rateReviewWord(progress, plan, 4, "w0", "unmastered");
  assert.equal(reviewAccess(progress, plan, 8).allowed, false);
  progress = rateReviewWord(progress, plan, 4, "w1", "unclear");
  assert.equal(reviewAccess(progress, plan, 8).allowed, true);
});

test("empty review requires explicit confirmation and creates no word review history", () => {
  const progress = learned(3, "mastered");
  assert.throws(() => startReviewDay(progress, plan, 4, true), /确认/);
  assert.equal(progress.planDays[4], undefined);
  const next = startReviewDay(progress, plan, 4, true, true);
  assert.equal(isPlanDayComplete(next, plan[3]), true);
  assert.deepEqual(next.reviewHistory, []);
  assert.deepEqual(next.words, progress.words);
  assert.equal(currentPlanDayNumber(next, plan), 5);
});

test("completion flags alone cannot complete a review and search never substitutes review ratings", () => {
  let progress = startReviewDay(learned(3), plan, 4, true);
  progress.planDays[4].completedAt = new Date().toISOString();
  progress.planDays[4].reviewedWordIds = ["w0", "w1", "w2"];
  progress = rateSearchWord(progress, "w0", "mastered");
  assert.equal(isPlanDayComplete(progress, plan[3]), false);
  assert.equal(planDayFraction(progress, plan[3]), 0);
});

test("plan position advances immediately, ignores the clock, and has an explicit end", () => {
  let progress = emptyProgress();
  assert.equal(currentPlanDayNumber(progress, plan), 1);
  progress = rateSearchWord(progress, "w0", "mastered");
  assert.equal(currentPlanDayNumber(progress, plan), 2);
  for (const date of ["2000-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z"]) {
    progress.words.w0.lastSeenAt = date;
    assert.equal(currentPlanDayNumber(progress, plan), 2);
  }
  progress = learned(6, "mastered");
  progress = startReviewDay(progress, plan, 4, true, true);
  progress = startReviewDay(progress, plan, 8, true, true);
  assert.equal(currentPlanDayNumber(progress, plan), null);
  progress = rateSearchWord(progress, "w0", "unmastered");
  assert.equal(currentPlanDayNumber(progress, plan), null);
});

test("independently started copies share a round, union ratings, and retry without double counting", () => {
  const original = learned(3);
  let a = startReviewDay(original, plan, 4, true);
  let b = startReviewDay(original, plan, 4, true);
  b.planDays[4].startedAt = "2099-01-01T00:00:00.000Z";
  assert.equal(a.planDays[4].reviewRoundId, b.planDays[4].reviewRoundId);
  a = rateReviewWord(a, plan, 4, "w0", "mastered");
  a = rateReviewWord(a, plan, 4, "w1", "unclear");
  b = rateReviewWord(b, plan, 4, "w2", "unmastered");
  const merged = mergeProgress(a, b);
  assert.equal(isPlanDayComplete(merged, plan[3]), true);
  assert.deepEqual(mergeProgress(b, a), merged);
  assert.deepEqual(mergeProgress(merged, a), merged);
  assert.equal(startReviewDay(merged, plan, 4, false), merged, "resume cannot replace a live or finished queue");
  const rerated = rateReviewWord(merged, plan, 4, "w0", "unmastered");
  assert.equal(rerated.words.w0.reviewCount, 1);
  assert.equal(mergeProgress(rerated, merged).reviewHistory.length, 3);
});
