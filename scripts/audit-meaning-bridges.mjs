import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { compileBridgeRecords, loadMeaningBridges } from "./meaning-bridge-data.mjs";
import { buildBridgeOrder, selectMeaningBridge } from "../src/meaning-bridges.ts";
import { emptyProgress } from "../src/progress.ts";

const bookCode = process.env.CYWORD_BOOK ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(bookCode)) throw new Error("Invalid book code");
const bookDir = path.resolve("books", bookCode);
const manifest = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));
const config = manifest.meaningBridgeEnhancement;
if (!config) throw new Error("Book has no meaning bridge enhancement");
const read = name => parse(fs.readFileSync(path.join(bookDir, "csv", name)), { columns: true, bom: true });
const words = read("words.csv"), relations = read("relation_words.csv");
const reviews = fs.readFileSync(path.join(bookDir, config.reviewFile), "utf8").trim().split(/\r?\n/).map(JSON.parse);
// 只能从已逐对填写理由的审核源重建，不自动接受新关系。
if (process.argv.includes("--compile")) {
  const records = compileBridgeRecords(words, relations, reviews);
  fs.writeFileSync(path.join(bookDir, config.recordsFile), records.map(row => JSON.stringify(row)).join("\n") + "\n");
  console.log(`Compiled ${records.length} per-word records from reviewed pairs. Rebuild data before auditing.`);
} else {
  const bridges = loadMeaningBridges(bookDir, manifest, words, relations);
  const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
  assert.equal(catalog.book.code, bookCode);
  const order = buildBridgeOrder(catalog);
  const progress = emptyProgress();
  const perWord = words.map(word => {
    const detail = JSON.parse(fs.readFileSync(path.join("data/words", `${word.word_id}.json`), "utf8"));
    assert.deepEqual(detail.meaningBridges ?? [], bridges.get(word.word_id));
    assert.equal(detail.memoryMarkup, word.memory_markup);
    assert.equal(detail.etymologyMarkup, word.etymology_markup);
    const selected = selectMeaningBridge(detail, catalog, progress, order);
    if (selected) assert.ok(order.first.get(selected.anchorId) < order.first.get(word.word_id));
    return { wordId: word.word_id, spelling: word.spelling, candidates: bridges.get(word.word_id).length,
      firstExposure: selected ? { anchor: selected.anchorSpelling, relation: selected.relation, explanation: selected.explanation } : null,
      result: selected ? "visible" : bridges.get(word.word_id).length ? "hidden-until-anchor-familiar" : "hidden-no-reviewed-candidate" };
  });
  const summary = { bookCode, words: perWord.length, reviewedPairs: reviews.length,
    acceptedPairs: reviews.filter(row => row.status === "accepted").length,
    rejectedPairs: reviews.filter(row => row.status === "rejected").length,
    wordsWithCandidates: perWord.filter(row => row.candidates).length,
    visibleAtFirstExposureWithoutRecords: perWord.filter(row => row.firstExposure).length,
    originalMemoryUnchanged: true };
  fs.mkdirSync(".work/meaning-bridges", { recursive: true });
  fs.writeFileSync(".work/meaning-bridges/acceptance.json", JSON.stringify({ summary, perWord }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
