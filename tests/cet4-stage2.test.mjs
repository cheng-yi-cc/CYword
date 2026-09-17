import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSample,
  loadStage2,
  sampleBookDir,
  validateGenerated,
} from "../scripts/cet4/stage2-lib.mjs";

test("CET4 stage 2 sample stays complete and reproducible", () => {
  const data = loadStage2();
  const built = buildSample(data);
  const generated = validateGenerated(data, built, sampleBookDir);
  assert.equal(data.batches.length, 3);
  assert.equal(built.book.statistics.uniqueWords, 30);
  assert.equal(built.book.statistics.ordinaryExamples, 30);
  assert.equal(built.book.statistics.longSentences, 30);
  assert.equal(built.tables["long_sentence_segments.csv"].length, 90);
  assert.equal(built.tables["long_sentence_analysis.csv"].length, 60);
  assert.equal(generated.canonicalTables, 19);
});
