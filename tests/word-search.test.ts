import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bookWordOrder, searchBookWords } from "../src/word-search.ts";
import { buildPlan, completedStudyExposureKeys, emptyProgress, planDayFraction, rateReviewWord, rateSearchWord, rateStudyWord, reconcileCompletion, startReviewDay, vocabularyOverview } from "../src/progress.ts";
import { mergeProgress } from "../src/sync-merge.ts";
import { ProgressSync } from "../src/sync-client.ts";
import { validProgress } from "../website/server/progress-sync.ts";
import type { Catalog, StudyGroup } from "../src/types.ts";

const group = (id: string, ids: string[]): StudyGroup => ({ id, wordIds: ids, wordCount: ids.length, kind: "root", rootId: id, spelling: id, meaning: "", memoryMethod: "", firstOrder: 0 });
const a = group("root:a", ["sword", "system"]), b = group("root:b", ["syntax", "sword"]), c = group("solo:c", ["essay"]);
const catalog = {
  groups: [a, b, c],
  words: Object.fromEntries(["system", "essay", "syntax", "sword"].map((id) => [id, { id, spelling: id, definitionCn: "中文释义", pronunciation: "" }])),
  schedule: [
    { day: 1, groupIds: [a.id, b.id], exposureOrder: [2, 0, 1, 3], appearanceCount: 4, uniqueWordCount: 3 },
    { day: 2, groupIds: [c.id], appearanceCount: 1, uniqueWordCount: 1 },
    { day: 3, groupIds: [a.id], appearanceCount: 2, uniqueWordCount: 2 },
  ],
} as Catalog;

test("search uses a case-insensitive prefix and first curriculum appearance, never alphabetic or object order", () => {
  const order = bookWordOrder(catalog);
  assert.deepEqual(order, ["syntax", "sword", "system", "essay"]);
  assert.deepEqual(searchBookWords(catalog, order, " S "), ["syntax", "sword", "system"]);
  assert.deepEqual(searchBookWords(catalog, order, "SY"), ["syntax", "system"]);
  assert.deepEqual(searchBookWords(catalog, order, "stem"), []);
  assert.deepEqual(searchBookWords(catalog, order, ""), []);
  assert.deepEqual(searchBookWords(catalog, order, "中文"), []);
});

test("full-book search covers each of the 5166 words exactly once", () => {
  const book: Catalog = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url), "utf8"));
  const order = bookWordOrder(book);
  assert.equal(order.length, 5166);
  assert.deepEqual(new Set(order), new Set(Object.keys(book.words)));
  for (const prefix of ["S", "SY"]) {
    const results = searchBookWords(book, order, prefix);
    assert.ok(results.length > 0);
    assert.deepEqual(results, order.filter((id) => book.words[id].spelling.toLowerCase().startsWith(prefix.toLowerCase())));
  }
});

test("all three search ratings count as learned without inventing exposures or reviews", () => {
  const plans = buildPlan(catalog);
  for (const level of ["unmastered", "unclear", "mastered"] as const) {
    const original = emptyProgress();
    const rated = rateSearchWord(original, "sword", level);
    assert.deepEqual(original, emptyProgress());
    assert.deepEqual(rated.planDays, {});
    const progress = reconcileCompletion(rated, catalog);
    assert.equal(planDayFraction(progress, plans[0]), 0.5, "both scheduled groups count the learned word");
    assert.equal(planDayFraction(progress, plans[2]), 0.5, "future days start with learned words credited");
    assert.equal(completedStudyExposureKeys(progress, plans[0]).length, 2);
    assert.equal(progress.words.sword.exposures, 0);
    assert.deepEqual(progress.planDays[1].ratedExposureKeys, []);
    assert.equal(progress.planDays[1].completedAt, undefined);
    assert.equal(vocabularyOverview(progress, catalog).counts.unlearned, 3);
    assert.ok(validProgress(progress));
  }
});

test("20 searched words start a 100-word day at 20; rating the remaining 80 completes it", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `word${index}`);
  const full = group("root:full", ids);
  const book = { ...catalog, groups: [full], schedule: [{ day: 1, groupIds: [full.id], appearanceCount: 100, uniqueWordCount: 100 }] } as Catalog;
  const plan = buildPlan(book)[0];
  let progress = emptyProgress();
  for (const id of ids.slice(0, 20)) progress = rateSearchWord(progress, id, "unclear");
  progress = reconcileCompletion(progress, book);
  assert.equal(completedStudyExposureKeys(progress, plan).length, 20);
  assert.equal(planDayFraction(progress, plan), 0.2);
  for (const id of ids.slice(20)) progress = rateStudyWord(progress, plan, full, id, "unmastered");
  progress = reconcileCompletion(progress, book);
  assert.equal(planDayFraction(progress, plan), 1);
  assert.ok(progress.planDays[1].completedAt);
  assert.equal(progress.planDays[1].ratedExposureKeys.length, 80);
  assert.deepEqual(reconcileCompletion(progress, book), progress);
});

test("search does not complete scheduled reviews or inflate counts when rerated and synced", async () => {
  let progress = rateSearchWord(emptyProgress(), "sword", "unclear");
  progress = startReviewDay(progress, 4, ["sword"], true);
  const rerated = rateSearchWord(progress, "sword", "mastered");
  assert.equal(rerated.words.sword.learnedAt, progress.words.sword.learnedAt);
  assert.deepEqual(rerated.planDays[4], progress.planDays[4]);
  assert.deepEqual(rerated.reviewHistory, []);
  let cloud = rateSearchWord(emptyProgress(), "system", "unmastered");
  let status = "", puts = 0;
  const sync = new ProgressSync({
    read: async () => rerated, write: async () => {}, change: (_, next) => { status = next; },
    reconcile: (value) => reconcileCompletion(value, catalog),
    request: async (input) => {
      if (input) { cloud = input.progress; puts++; }
      return { status: 200, data: { revision: puts, progress: structuredClone(cloud) } };
    },
  });
  await sync.open(); sync.stop();
  assert.equal(status, "synced");
  assert.equal(puts, 1);
  assert.ok(cloud.planDays[3].completedAt);
  assert.equal(cloud.planDays[4].completedAt, undefined);
  assert.equal(cloud.words.sword.exposures, 0);
  assert.equal(mergeProgress(cloud, rerated).words.sword.exposures, 0);
  assert.ok(rateReviewWord(cloud, 4, "sword", "unclear").planDays[4].completedAt);
});
