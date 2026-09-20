import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { loadPronunciationGuides } from "./pronunciation-data.mjs";
import { loadMeaningBridges } from "./meaning-bridge-data.mjs";

const projectRoot = process.cwd();
const bookCode = process.env.CYWORD_BOOK ?? process.argv[2] ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(bookCode)) {
  throw new Error(`Invalid book code: ${bookCode}`);
}

const bookDir = path.join(projectRoot, "books", bookCode);
const csvDir = path.join(bookDir, "csv");
const manifest = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));
const csvCache = new Map();

function readCsv(name) {
  if (csvCache.has(name)) return csvCache.get(name);
  const filePath = path.join(csvDir, name);
  if (!fs.existsSync(filePath)) throw new Error(`Missing canonical table: ${name}`);
  const rows = parse(fs.readFileSync(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  csvCache.set(name, rows);
  return rows;
}

function assertCount(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, found ${actual}`);
}

const actualFiles = fs.readdirSync(csvDir).filter((name) => name.endsWith(".csv")).sort();
const expectedFiles = [...manifest.canonicalFiles].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Canonical file set mismatch for ${bookCode}`);
}

const tableCatalog = readCsv("table_catalog.csv");
for (const table of tableCatalog) {
  const actualRows = readCsv(table.table_file).length;
  const expectedRows = Number(table.row_count);
  if (actualRows !== expectedRows) {
    throw new Error(`${table.table_file}: expected ${expectedRows} rows, found ${actualRows}`);
  }
}

const words = readCsv("words.csv");
const pronunciationGuides = loadPronunciationGuides(bookDir, manifest, words);
const meaningBridges = loadMeaningBridges(bookDir, manifest, words, readCsv("relation_words.csv"));
const wordIds = new Set(words.map((row) => row.word_id));
if (wordIds.size !== words.length) throw new Error("words.csv contains duplicate word_id values");
assertCount("Unique words", words.length, manifest.statistics.uniqueWords);

const wordForeignKeyTables = [
  "sentence_zones.csv",
  "examples.csv",
  "long_sentences.csv",
  "long_sentence_segments.csv",
  "long_sentence_analysis.csv",
  "exam_examples.csv",
  "frequencies.csv",
  "collocations.csv",
  "word_markup_links.csv",
  "root_markups.csv",
  "root_markup_links.csv",
  "relations.csv",
  "relation_words.csv",
  "analysis_seen_marks.csv",
];
for (const file of wordForeignKeyTables) {
  const orphan = readCsv(file).find((row) => !wordIds.has(row.word_id));
  if (orphan) throw new Error(`${file} contains orphan word_id ${orphan.word_id}`);
}

const roots = readCsv("root_markups.csv");
const trueRoots = roots.filter((row) => row.root_type === "root" && row.root_id);
const trueRootIds = new Set(trueRoots.map((row) => row.root_id));
const rootedWords = new Set(trueRoots.map((row) => row.word_id));
const rootWords = new Map();
const wordRootIds = new Map();
for (const row of trueRoots) {
  if (!rootWords.has(row.root_id)) rootWords.set(row.root_id, new Set());
  if (!wordRootIds.has(row.word_id)) wordRootIds.set(row.word_id, new Set());
  rootWords.get(row.root_id).add(row.word_id);
  wordRootIds.get(row.word_id).add(row.root_id);
}
const soloWords = words.length - rootedWords.size;
const multiRootWords = [...wordRootIds.values()].filter((ids) => ids.size > 1).length;
const rootAppearances = [...rootWords.values()].reduce((sum, ids) => sum + ids.size, 0);
const largestTrueRootGroup = Math.max(...[...rootWords.values()].map((ids) => ids.size));

assertCount("Root markup rows", roots.length, manifest.statistics.rootMarkupRows);
assertCount("True roots", trueRootIds.size, manifest.statistics.trueRoots);
assertCount("Words with true roots", rootedWords.size, manifest.statistics.wordsWithTrueRoot);
assertCount("Solo words", soloWords, manifest.statistics.soloWords);
assertCount("Multi-root words", multiRootWords, manifest.statistics.multiRootWords);
assertCount("Study groups", trueRootIds.size + soloWords, manifest.statistics.studyGroups);
assertCount("Study appearances", rootAppearances + soloWords, manifest.statistics.studyAppearances);
assertCount("Largest true-root group", largestTrueRootGroup, manifest.statistics.largestTrueRootGroup);
assertCount("Ordinary examples", readCsv("examples.csv").length, manifest.statistics.ordinaryExamples);
assertCount("Exam examples", readCsv("exam_examples.csv").length, manifest.statistics.examExamples);
assertCount("Long sentences", readCsv("long_sentences.csv").length, manifest.statistics.longSentences);
assertCount("Collocations", readCsv("collocations.csv").length, manifest.statistics.collocations);
assertCount("Frequencies", readCsv("frequencies.csv").length, manifest.statistics.frequencies);

const summary = {
  book: `${manifest.name} (${bookCode})`,
  canonicalFiles: actualFiles.length,
  uniqueWords: words.length,
  pronunciationGuides: pronunciationGuides.size,
  meaningBridgeRecords: meaningBridges.size,
  wordsWithMeaningBridges: [...meaningBridges.values()].filter(bridges => bridges.length).length,
  wordForeignKeyOrphans: 0,
  rootMarkupRows: roots.length,
  trueRoots: trueRootIds.size,
  wordsWithTrueRoot: rootedWords.size,
  soloWords,
  multiRootWords,
  studyGroups: trueRootIds.size + soloWords,
  studyAppearances: rootAppearances + soloWords,
};
console.log(JSON.stringify(summary, null, 2));
