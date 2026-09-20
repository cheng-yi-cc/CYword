import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { buildBridgeOrder, selectMeaningBridge } from "../src/meaning-bridges.ts";
import { emptyProgress } from "../src/progress.ts";
import type { Catalog, WordDetail, Proficiency } from "../src/types.ts";
import { compileBridgeRecords, loadMeaningBridges, validateBridgeReviews } from "../scripts/meaning-bridge-data.mjs";

const catalog: Catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("books/cet6/book.json", "utf8"));
const csv = (name: string) => parse(fs.readFileSync(`books/cet6/csv/${name}.csv`), { columns: true, bom: true });
const words = csv("words"), relations = csv("relation_words");
const reviews = fs.readFileSync("books/cet6/enhancements/meaning-bridge-reviews.jsonl", "utf8").trim().split(/\r?\n/).map(JSON.parse);
const order = buildBridgeOrder(catalog);
const details: Record<string, WordDetail> = Object.fromEntries(Object.keys(catalog.words).map(id => [id, JSON.parse(fs.readFileSync(`data/words/${id}.json`, "utf8"))]));
const detail = (spelling: string) => Object.values(details).find(word => word.spelling === spelling)!;

test("entire book: compiled reviewed links match source, and positional selection never introduces a future or outside word", () => {
  const source = loadMeaningBridges("books/cet6", manifest, words, relations);
  assert.equal(source.size, 5166);
  const progress = emptyProgress();
  for (const word of words) {
    assert.deepEqual(details[word.word_id].meaningBridges ?? [], source.get(word.word_id));
    assert.equal(details[word.word_id].memoryMarkup, word.memory_markup);
    assert.equal(details[word.word_id].etymologyMarkup, word.etymology_markup);
  }
  for (const [day, {offset, wordIds}] of order.days) wordIds.forEach((id, index) => {
    const selected = selectMeaningBridge(details[id], catalog, progress, order, {day, index});
    if (selected) {
      assert.ok(catalog.words[selected.anchorId]);
      assert.notEqual(selected.anchorId, id);
      assert.ok(order.first.get(selected.anchorId)! < offset + index);
    }
  });
  assert.equal(Object.keys(progress.words).length, 0);
});

test("earlier planned words qualify without ratings; future words qualify after learning at every proficiency", () => {
  const pair = reviews.find((row: any) => row.status === "accepted");
  const [early, late] = [...pair.wordIds].sort((a, b) => order.first.get(a)! - order.first.get(b)!);
  const target = {...details[early], meaningBridges: details[early].meaningBridges!.filter(b => b.anchorId === late)};
  const laterTarget = {...details[late], meaningBridges: details[late].meaningBridges!.filter(b => b.anchorId === early)};
  assert.equal(selectMeaningBridge(laterTarget, catalog, emptyProgress(), order)?.anchorId, early);
  assert.equal(selectMeaningBridge(target, catalog, emptyProgress(), order), undefined);
  for (const proficiency of ["unmastered", "unclear", "mastered"] as Proficiency[]) {
    const progress = emptyProgress();
    progress.words[late] = {learnedAt:"2026-09-20",lastSeenAt:"2026-09-20",proficiency,reviewCount:0,exposures:1};
    assert.equal(selectMeaningBridge(target, catalog, progress, order)?.anchorId, late);
    progress.words[late].learnedAt = "";
    assert.equal(selectMeaningBridge(target, catalog, progress, order), undefined);
  }
});

test("second exposure uses its actual plan position, not the word's first appearance", () => {
  const word = detail("symposium"), anchor = detail("conference");
  const fixture = {first:new Map([[word.id,0],[anchor.id,1]]),days:new Map([[1,{offset:0,wordIds:[word.id,anchor.id,word.id]}]])};
  assert.equal(selectMeaningBridge(word, catalog, emptyProgress(), fixture), undefined);
  assert.equal(selectMeaningBridge(word, catalog, emptyProgress(), fixture, {day:1,index:2})?.anchorId, anchor.id);
  assert.equal(selectMeaningBridge(word, catalog, emptyProgress(), fixture, {day:1,index:1}), undefined);
});

test("empty, self, outside-book and mismatched-book candidates stay hidden", () => {
  const word = detail("symposium"), candidate = word.meaningBridges![0];
  const progress = emptyProgress();
  progress.words[word.id] = {learnedAt:"2026-09-20",lastSeenAt:"2026-09-20",proficiency:"mastered",reviewCount:0,exposures:1};
  for (const changed of [
    {...word,meaningBridges:[]}, {...word,bookCode:"cet4"},
    {...word,meaningBridges:[{...candidate,anchorId:word.id,anchorSpelling:word.spelling}]},
    {...word,meaningBridges:[{...candidate,anchorId:"outside"}]},
    {...word,meaningBridges:[{...candidate,anchorSpelling:"not-the-anchor"}]},
  ]) assert.equal(selectMeaningBridge(changed, catalog, progress, order), undefined);
});

test("review gate rejects missing reviews, changed source meaning, bad endpoints and wrong relation types", () => {
  assert.throws(() => validateBridgeReviews(words, relations, reviews.slice(1)), /Unreviewed/);
  const changedWords = structuredClone(words);
  changedWords.find((w: any) => w.word_id === reviews[0].wordIds[0]).definition_cn += "改动";
  assert.throws(() => validateBridgeReviews(changedWords, relations, reviews), /stale/);
  const wrong = structuredClone(reviews);
  const accepted = wrong.find((r: any) => r.status === "accepted" && r.origin === "book-relations");
  accepted.relation = accepted.relation === "antonym" ? "near_synonym" : "antonym";
  assert.throws(() => validateBridgeReviews(words, relations, wrong), /conflicting/);
  wrong[0].wordIds[0] = "outside-book";
  assert.throws(() => validateBridgeReviews(words, relations, wrong), /endpoints/);
});

test("all words have explicit dispositions; known bad antonyms and derivatives never enter accepted data", () => {
  const records = compileBridgeRecords(words, relations, reviews);
  assert.equal(records.length, 5166);
  assert.equal(new Set(records.map((r: any) => r.wordId)).size, 5166);
  for (const [a,b] of [["medium","vehicle"],["eliminate","exclude"],["necessary","essential"],["hypothesis","hypothetical"]]) {
    assert.ok(!details[detail(a).id].meaningBridges?.some(bridge => bridge.anchorId === detail(b).id));
  }
  assert.ok(detail("symposium").meaningBridges?.some(b => b.anchorSpelling === "conference"));
  assert.equal(loadMeaningBridges("books/cet6", {}, words, relations).size, 0);
});
