import assert from "node:assert/strict";
import { buildSample, loadStage2, sampleBookDir, validateGenerated, validateSource } from "./stage2-lib.mjs";

const data = loadStage2();
const built = buildSample(data);
const generated = validateGenerated(data, built, sampleBookDir);
const report = {
  stage: 2,
  batches: data.batches.length,
  words: built.book.statistics.uniqueWords,
  canonicalTables: generated.canonicalTables,
  morphemes: data.morphemes.length,
  evidence: data.evidence.length,
  ordinaryExamples: built.book.statistics.ordinaryExamples,
  collocations: built.book.statistics.collocations,
  longSentences: built.book.statistics.longSentences,
  longSentenceSegments: built.tables["long_sentence_segments.csv"].length,
  longSentenceAnalyses: built.tables["long_sentence_analysis.csv"].length,
  invalidFixturesRejected: 0,
};

if (process.argv.includes("--self-test")) {
  const mutations = [
    ["blank required field", (copy) => { copy.batches[0].entries[0].definitionCn = ""; }, /blank/u],
    ["duplicate word", (copy) => { copy.batches[0].entries[1] = structuredClone(copy.batches[0].entries[0]); }, /Duplicate sample spelling/u],
    ["invalid relation", (copy) => { copy.batches[0].entries[0].relations = [{ type: "antonym", words: [{ spelling: "not-in-sample", displayText: "错误目标", meaning: "错误" }] }]; }, /outside the compiled sample/u],
    ["broken sentence reconstruction", (copy) => { copy.batches[0].entries[0].longSentences[0].segments[0].text += "x"; }, /do not reconstruct/u],
    ["invalid analysis reference", (copy) => { copy.batches[0].entries[0].longSentences[0].analyses[0].refs = [999]; }, /invalid ref/u],
    ["missing target surface", (copy) => { copy.batches[0].entries[0].longSentences[0].targetSurface = "not-present"; }, /does not contain targetSurface/u],
  ];
  for (const [name, mutate, pattern] of mutations) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validateSource(copy), pattern, `Fixture did not fail: ${name}`);
    report.invalidFixturesRejected += 1;
  }
}

console.log(JSON.stringify(report, null, 2));
