import { loadStage2, sampleBookDir, writeSample } from "./stage2-lib.mjs";

const built = writeSample(loadStage2());
console.log(JSON.stringify({
  output: sampleBookDir,
  words: built.book.statistics.uniqueWords,
  canonicalTables: built.book.canonicalFiles.length,
  ordinaryExamples: built.book.statistics.ordinaryExamples,
  longSentences: built.book.statistics.longSentences,
}, null, 2));
