import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlan,
  emptyProgress,
  planDayFraction,
  rateReviewWord,
  rateStudyWord,
  reviewCandidates,
  startReviewDay,
  updateWordProficiency,
  vocabularyOverview,
} from "../src/progress.ts";
import type { Catalog, StudyGroup } from "../src/types.ts";

const groupA: StudyGroup = {
  id: "root:a",
  kind: "root",
  rootId: "a",
  spelling: "a",
  meaning: "A",
  memoryMethod: "",
  wordIds: ["w1", "w2"],
  wordCount: 2,
  firstOrder: 1,
};

const catalog = {
  stats: { wordCount: 3, trueRootCount: 1, soloGroupCount: 0, studyGroupCount: 1, studyAppearanceCount: 6, scheduleDayCount: 6, targetPerDay: 190 },
  groups: [groupA],
  schedule: Array.from({ length: 6 }, (_, index) => ({ day: index + 1, groupIds: ["root:a"], appearanceCount: 2, uniqueWordCount: 2 })),
  words: {},
  generatedAt: "",
} as Catalog;

test("three study days are followed by one cumulative review day", () => {
  const plan = buildPlan(catalog);
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map((day) => day.kind), ["study", "study", "study", "review", "study", "study", "study", "review"]);
  assert.equal(plan[3].plannedReviewWordCount, 2);
  assert.equal(plan[7].plannedReviewWordCount, 2);
});

test("a study exposure requires proficiency and completes its group atomically", () => {
  const plan = buildPlan(catalog)[0];
  let progress = emptyProgress();
  progress = rateStudyWord(progress, plan, groupA, "w1", "unmastered");
  assert.equal(progress.words.w1.proficiency, "unmastered");
  assert.equal(planDayFraction(progress, plan), 0.5);
  assert.deepEqual(progress.planDays["1"].completedGroupIds, []);
  progress = rateStudyWord(progress, plan, groupA, "w2", "unclear");
  assert.deepEqual(progress.planDays["1"].completedGroupIds, ["root:a"]);
  assert.ok(progress.planDays["1"].completedAt);
});

test("review defaults can skip mastered words and ratings remain adjustable", () => {
  const plan = buildPlan(catalog)[0];
  let progress = rateStudyWord(emptyProgress(), plan, groupA, "w1", "mastered");
  progress = rateStudyWord(progress, plan, groupA, "w2", "unclear");
  assert.deepEqual(reviewCandidates(progress, true), ["w2"]);
  assert.deepEqual(new Set(reviewCandidates(progress, false)), new Set(["w1", "w2"]));
  progress = startReviewDay(progress, 4, ["w2"], true);
  progress = rateReviewWord(progress, 4, "w2", "mastered");
  assert.equal(progress.words.w2.proficiency, "mastered");
  assert.ok(progress.planDays["4"].completedAt);
});

const vocabularyCatalog = { ...catalog, words: { w1: {}, w2: {}, w3: {} } } as Catalog;

test("vocabulary membership follows learned ratings, not legacy bookmarks or other books", () => {
  let progress = rateStudyWord(emptyProgress(), buildPlan(catalog)[0], groupA, "w1", "mastered");
  progress = rateStudyWord(progress, buildPlan(catalog)[0], groupA, "w2", "unclear");
  progress.bookmarks = { w1: "2026-09-17", w3: "2026-09-17" };
  progress.words.oldBookWord = { ...progress.words.w2 };
  const overview = vocabularyOverview(progress, vocabularyCatalog);
  assert.deepEqual(overview.ids, ["w2"]);
  assert.deepEqual(overview.counts, { mastered: 1, unclear: 1, unmastered: 0, unlearned: 1 });
  assert.equal(overview.total, 3);
  progress = startReviewDay(progress, 4, ["w2"], true);
  progress = rateReviewWord(progress, 4, "w2", "mastered");
  assert.deepEqual(vocabularyOverview(progress, vocabularyCatalog).ids, []);
  assert.ok(progress.words.w2.learnedAt, "mastered words keep their learning records");
});

test("reassessing vocabulary updates mastery without crediting planned learning or review", () => {
  let progress = rateStudyWord(emptyProgress(), buildPlan(catalog)[0], groupA, "w1", "unclear");
  progress = startReviewDay(progress, 4, ["w1"], true);
  progress.words.w1.lastSeenAt = "2026-01-01T00:00:00.000Z";
  const next = updateWordProficiency(progress, "w1", "mastered");
  assert.deepEqual(next.planDays, progress.planDays);
  assert.deepEqual(next.reviewHistory, progress.reviewHistory);
  assert.equal(next.words.w1.exposures, progress.words.w1.exposures);
  assert.equal(next.words.w1.reviewCount, progress.words.w1.reviewCount);
  assert.ok(next.words.w1.lastSeenAt > progress.words.w1.lastSeenAt);
  assert.deepEqual(vocabularyOverview(next, vocabularyCatalog).ids, []);
  assert.deepEqual(vocabularyOverview(updateWordProficiency(next, "w1", "unmastered"), vocabularyCatalog).ids, ["w1"]);
  assert.equal(updateWordProficiency(next, "w3", "unmastered"), next, "unlearned words cannot acquire a rating here");
});
