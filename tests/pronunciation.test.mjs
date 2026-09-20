import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { loadPronunciationGuides, pronunciationHash } from "../scripts/pronunciation-data.mjs";

const bookDir = path.resolve("books/cet6");
const manifest = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));
const words = parse(fs.readFileSync(path.join(bookDir, "csv/words.csv"), "utf8"), { columns: true, bom: true });
const guides = loadPronunciationGuides(bookDir, manifest, words);
const id = spelling => words.find(word => word.spelling === spelling).word_id;

test("all 5166 words have accepted, lossless pronunciation guides in compiled API data", () => {
  assert.equal(guides.size, 5166);
  for (const word of words) {
    const compiled = JSON.parse(fs.readFileSync(path.resolve("data/words", `${word.word_id}.json`), "utf8"));
    assert.deepEqual(compiled.pronunciationGuide, guides.get(word.word_id));
    assert.equal(compiled.pronunciation, guides.get(word.word_id).pronunciation);
    assert.equal(compiled.memoryMarkup, word.memory_markup);
    assert.equal(compiled.etymologyMarkup, word.etymology_markup);
  }
});

test("irregular spelling, source errors and optional phonemes retain explicit guidance", () => {
  assert.deepEqual(guides.get(id("symposium")).chunks.map(c => [c.text, c.ipa, c.stress]), [
    ["sym", "sɪm", "none"], ["po", "pəʊ", "primary"], ["si", "zi", "none"], ["um", "əm", "none"],
  ]);
  assert.equal(guides.get(id("uniform")).pronunciation, "/ˈjuːnɪfɔːm/");
  assert.equal(guides.get(id("conductive")).pronunciation, "/kənˈdʌktɪv/");
  assert.equal(guides.get(id("deadlocked")).pronunciation, "/ˈdedlɑːkt/");
  assert.ok(guides.get(id("colonel")).notes.length);
  assert.ok(guides.get(id("enter")).chunks.some(c => c.ipa.includes("(r)")));
});

test("reject stale review, wrong source, lost letters, lost sounds and wrong stress", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cyword-pronunciation-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, "enhancements"));
  const word = words.find(w => w.spelling === "symposium");
  const record = {wordId:word.word_id, spelling:word.spelling, sourcePronunciation:word.pronunciation, guide:guides.get(word.word_id)};
  const config = {...manifest, pronunciationEnhancement:{...manifest.pronunciationEnhancement,wordCount:1}};
  function write(changed, fresh = true) {
    fs.writeFileSync(path.join(temp, config.pronunciationEnhancement.guidesFile), JSON.stringify(changed));
    fs.writeFileSync(path.join(temp, config.pronunciationEnhancement.reviewFile), JSON.stringify({wordId:word.word_id,guideSha256:pronunciationHash(fresh ? changed : record),status:"accepted",method:"alignment-and-exception-review"}));
  }
  for (const mutate of [
    r => { r.guide.chunks[0].text = "sim"; },
    r => { r.guide.chunks[1].ipa = "poʊ"; },
    r => { r.guide.chunks[1].stress = "none"; },
    r => { r.guide.chunks[1].stress = "none"; r.guide.chunks[0].stress = "primary"; },
    r => { r.sourcePronunciation = "/wrong/"; },
  ]) {
    const changed = structuredClone(record); mutate(changed); write(changed);
    assert.throws(() => loadPronunciationGuides(temp, config, [word]));
  }
  const changed = structuredClone(record); changed.guide.notes.push("未复核的新提示"); write(changed, false);
  assert.throws(() => loadPronunciationGuides(temp, config, [word]), /stale/);
});

test("books without enhancement files remain compatible", () => {
  assert.equal(loadPronunciationGuides(bookDir, {}, words).size, 0);
});
