import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const projectRoot = process.cwd();
const bookCode = process.env.CYWORD_BOOK ?? process.argv[2] ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(bookCode)) {
  throw new Error(`Invalid book code: ${bookCode}`);
}
const bookDir = path.join(projectRoot, "books", bookCode);
const csvDir = path.join(bookDir, "csv");
const outDir = path.join(projectRoot, "data");
const wordOutDir = path.join(outDir, "words");
const bookManifest = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));

function readCsv(name) {
  const source = fs.readFileSync(path.join(csvDir, name), "utf8");
  return parse(source, { columns: true, skip_empty_lines: true, bom: true });
}

function indexMany(rows, key = "word_id") {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function bool(value) {
  return String(value).toLowerCase() === "true";
}

function number(value) {
  if (value === "" || value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function cleanWord(row) {
  return {
    id: row.word_id,
    spelling: row.spelling,
    pronunciation: row.pronunciation || "",
    definitionCn: row.definition_cn || "",
    audioUrl: row.audio_url || "",
    memoryMarkup: row.memory_markup || "",
    etymologyMarkup: row.etymology_markup || "",
    rootAffixNotes: row.root_affix_notes || "",
    rootAffixAccumulation: row.root_affix_accumulation || "",
    bookCode: row.book_code,
    bookName: row.book_name,
    originalDay: number(row.day_number),
    originalOrder: number(row.word_order) ?? number(row.order_in_day) ?? 0,
    sourceStats: {
      exampleCount: number(row.example_count) ?? 0,
      examExampleCount: number(row.exam_example_count) ?? 0,
      longSentenceCount: number(row.long_sentence_count) ?? 0,
      collocationCount: number(row.collocation_count) ?? 0,
      frequencyCount: number(row.frequency_count) ?? 0,
      relationGroupCount: number(row.relation_group_count) ?? 0,
      detailStatus: row.detail_status,
      accessAllowed: bool(row.access_allowed),
    },
  };
}

function uniqueBy(rows, keyFn) {
  return [...new Map(rows.map((item) => [keyFn(item), item])).values()];
}

function packStudyDays(groups, target = 190) {
  const totalAppearances = groups.reduce((sum, group) => sum + group.wordIds.length, 0);
  const minimumDayCount = Math.ceil(totalAppearances / target);
  const plannedDayCount = Math.ceil(minimumDayCount / 3) * 3;
  const days = [];
  let unassignedAppearances = totalAppearances;
  let day = { day: 1, groupIds: [], appearanceCount: 0, unique: new Set() };

  for (const group of groups) {
    const daysRemaining = plannedDayCount - days.length;
    const balancedTarget = (day.appearanceCount + unassignedAppearances) / daysRemaining;
    const currentDistance = Math.abs(balancedTarget - day.appearanceCount);
    const nextDistance = Math.abs(balancedTarget - (day.appearanceCount + group.wordIds.length));
    if (
      day.groupIds.length > 0 &&
      day.appearanceCount >= balancedTarget * 0.82 &&
      nextDistance > currentDistance &&
      days.length < plannedDayCount - 1
    ) {
      days.push(day);
      day = { day: days.length + 1, groupIds: [], appearanceCount: 0, unique: new Set() };
    }
    day.groupIds.push(group.id);
    day.appearanceCount += group.wordIds.length;
    unassignedAppearances -= group.wordIds.length;
    for (const wordId of group.wordIds) day.unique.add(wordId);
  }
  if (day.groupIds.length) days.push(day);

  return days.map(({ unique, ...item }) => ({
    ...item,
    uniqueWordCount: unique.size,
  }));
}

const wordsRaw = readCsv("words.csv");
const rootsRaw = readCsv("root_markups.csv");
const examples = indexMany(readCsv("examples.csv"));
const examExamples = indexMany(readCsv("exam_examples.csv"));
const collocations = indexMany(readCsv("collocations.csv"));
const frequencies = indexMany(readCsv("frequencies.csv"));
const relationGroups = indexMany(readCsv("relations.csv"));
const relationWords = indexMany(readCsv("relation_words.csv"));
const longSentences = indexMany(readCsv("long_sentences.csv"));
const longSegments = indexMany(readCsv("long_sentence_segments.csv"));
const longAnalyses = indexMany(readCsv("long_sentence_analysis.csv"));
const sentenceZones = indexMany(readCsv("sentence_zones.csv"));
const rootsByWord = indexMany(rootsRaw);
const wordMap = new Map(wordsRaw.map((row) => [row.word_id, cleanWord(row)]));

const trueRootRows = rootsRaw.filter((row) => row.root_type === "root" && row.root_id);
const trueRootsById = indexMany(trueRootRows, "root_id");
const wordsWithTrueRoots = new Set(trueRootRows.map((row) => row.word_id));

const rootGroups = [...trueRootsById.entries()].map(([rootId, rows]) => {
  const wordIds = [...new Set(rows.map((row) => row.word_id))].sort(
    (a, b) => wordMap.get(a).originalOrder - wordMap.get(b).originalOrder,
  );
  const representative = rows.find((row) => row.memory_method) ?? rows[0];
  return {
    id: `root:${rootId}`,
    kind: "root",
    rootId,
    spelling: representative.spelling,
    meaning: representative.meaning,
    memoryMethod: representative.memory_method || "",
    wordIds,
    wordCount: wordIds.length,
    firstOrder: Math.min(...wordIds.map((id) => wordMap.get(id).originalOrder)),
  };
});

const soloGroups = wordsRaw
  .filter((row) => !wordsWithTrueRoots.has(row.word_id))
  .map((row) => {
    const word = wordMap.get(row.word_id);
    return {
      id: `solo:${row.word_id}`,
      kind: "solo",
      rootId: null,
      spelling: word.spelling,
      meaning: word.definitionCn,
      memoryMethod: word.memoryMarkup,
      wordIds: [word.id],
      wordCount: 1,
      firstOrder: word.originalOrder,
    };
  });

const groups = [...rootGroups, ...soloGroups].sort(
  (a, b) => a.firstOrder - b.firstOrder || b.wordCount - a.wordCount,
);
const schedule = packStudyDays(groups);

const summaryWords = Object.fromEntries(
  [...wordMap.values()].map((word) => [
    word.id,
    {
      id: word.id,
      spelling: word.spelling,
      pronunciation: word.pronunciation,
      definitionCn: word.definitionCn,
    },
  ]),
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(wordOutDir, { recursive: true });

for (const word of wordMap.values()) {
  const wordRoots = (rootsByWord.get(word.id) ?? []).map((row) => ({
    id: row.root_id,
    order: number(row.root_index) ?? 0,
    spelling: row.spelling,
    type: row.root_type,
    meaning: row.meaning,
    memoryMethod: row.memory_method || "",
  }));

  const detailedLongSentences = (longSentences.get(word.id) ?? []).map((sentence) => ({
    ...sentence,
    order_index: number(sentence.order_index),
    segments: (longSegments.get(word.id) ?? []).filter(
      (segment) => segment.long_sentence_id === sentence.long_sentence_id,
    ),
    analyses: (longAnalyses.get(word.id) ?? []).filter(
      (analysis) => analysis.long_sentence_id === sentence.long_sentence_id,
    ),
  }));

  const detail = {
    ...word,
    roots: wordRoots,
    examples: examples.get(word.id) ?? [],
    examExamples: examExamples.get(word.id) ?? [],
    collocations: collocations.get(word.id) ?? [],
    frequencies: frequencies.get(word.id) ?? [],
    relations: (relationGroups.get(word.id) ?? []).map((group) => ({
      ...group,
      words: (relationWords.get(word.id) ?? []).filter(
        (item) => item.relation_type === group.relation_type,
      ),
    })),
    longSentences: detailedLongSentences,
    sentenceZones: sentenceZones.get(word.id) ?? [],
  };
  fs.writeFileSync(
    path.join(wordOutDir, `${word.id}.json`),
    JSON.stringify(detail),
    "utf8",
  );
}

const catalog = {
  generatedAt: new Date().toISOString(),
  book: {
    code: bookManifest.code,
    name: bookManifest.name,
    targetExam: bookManifest.targetExam,
    schemaVersion: bookManifest.schemaVersion,
  },
  stats: {
    wordCount: wordsRaw.length,
    trueRootCount: rootGroups.length,
    soloGroupCount: soloGroups.length,
    studyGroupCount: groups.length,
    studyAppearanceCount: groups.reduce((sum, group) => sum + group.wordCount, 0),
    scheduleDayCount: schedule.length,
    targetPerDay: 190,
  },
  groups,
  schedule,
  words: summaryWords,
};
fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(catalog), "utf8");

console.log(
  `Built ${wordsRaw.length} word files, ${groups.length} study groups, ${schedule.length} study days.`,
);
