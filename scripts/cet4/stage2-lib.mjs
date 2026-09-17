import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { loadDrafts, expectedDraftProgress } from "./draft-lib.mjs";

export const projectRoot = process.cwd();
export const authoringDir = path.join(projectRoot, "authoring", "cet4");
export const sampleDir = path.join(authoringDir, "sample");
export const sampleBookDir = path.join(sampleDir, "book");

const WORD_LINK_FIELDS = ["memoryMarkup", "etymologyMarkup", "rootAffixNotes", "rootAffixAccumulation"];
const RELATION_TYPES = new Set(["synonym", "near_synonym", "antonym", "derivative"]);
const MORPHEME_TYPES = new Set(["root", "prefix", "suffix", "base"]);
const SEGMENT_ROLES = new Set(["subj", "pred", "obj", "attr", "adv", "appos", "ocomp", "scomp"]);
const ANALYSIS_KINDS = new Set(["structure", "difficulty", "target", "transfer", "culture"]);

export function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function readCsv(filePath) {
  return parse(fs.readFileSync(filePath, "utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  });
}

export function readCsvWithHeader(filePath) {
  const records = parse(fs.readFileSync(filePath, "utf8"), {
    bom: true,
    skip_empty_lines: false,
  });
  const [header = [], ...body] = records;
  return { header, rows: body.filter((row) => row.some((value) => value !== "")) };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsv(columns, rows) {
  return `${[columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

export function registryKey(row) {
  return `morph:${row.root_type}:${row.language}:${row.canonical_form}:${row.meaning_key}`;
}

function requiredText(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} is blank`);
}

function parseJsonArray(value, label) {
  const parsed = JSON.parse(value);
  assert.ok(Array.isArray(parsed), `${label} must be a JSON array`);
  return parsed;
}

export function extractMarkup(markup) {
  const links = [];
  for (const match of String(markup ?? "").matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu)) {
    links.push({ identifier: match[1].trim(), display: (match[2] ?? match[1]).trim() });
  }
  return links;
}

function normalizeForLookup(value) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function loadStage2() {
  const schema = JSON.parse(fs.readFileSync(path.join(authoringDir, "schema.json"), "utf8"));
  const fieldPolicy = readCsv(path.join(authoringDir, "field_policy.csv"));
  const wordlist = readCsv(path.join(authoringDir, "wordlist.csv"));
  const evidence = readCsv(path.join(authoringDir, "evidence.csv"));
  const morphemes = readCsv(path.join(projectRoot, "authoring/shared/morphemes.csv"));
  const progress = readCsv(path.join(authoringDir, "progress.csv"));
  const batchLedger = readCsv(path.join(authoringDir, "batches.csv"));
  const manifest = JSON.parse(fs.readFileSync(path.join(sampleDir, "manifest.json"), "utf8"));
  const batchFiles = fs.readdirSync(sampleDir)
    .filter((name) => /^batch-\d{3}\.json$/u.test(name))
    .sort();
  const batches = batchFiles.map((name) => JSON.parse(fs.readFileSync(path.join(sampleDir, name), "utf8")));
  return { schema, fieldPolicy, wordlist, evidence, morphemes, progress, batchLedger, manifest, batches, batchFiles };
}

export function validateSource(data) {
  const { schema, fieldPolicy, wordlist, evidence, morphemes, progress, batchLedger, manifest, batches } = data;
  assert.equal(Object.keys(schema.tables).length, 19, "Stage 2 must export all 19 canonical tables");
  assert.equal(fieldPolicy.length, 173, "Field policy must still cover 173 fields");
  assert.equal(manifest.schemaVersion, 1, "Unsupported sample manifest version");
  assert.equal(manifest.wordlistVersion, "cet4-2016-v1", "Sample uses the wrong frozen wordlist");
  assert.equal(batches.length, 3, "Stage 2 requires three reviewable batches");

  const wordBySpelling = new Map(wordlist.map((row) => [normalizeForLookup(row.canonical_spelling), row]));
  const evidenceById = new Map(evidence.map((row) => [row.evidence_id, row]));
  assert.equal(evidenceById.size, evidence.length, "Duplicate evidence_id");
  const morphemeByKey = new Map();
  const morphemeById = new Map();
  for (const row of morphemes) {
    const key = registryKey(row);
    assert.ok(MORPHEME_TYPES.has(row.root_type), `Invalid morpheme type: ${row.root_type}`);
    assert.equal(row.root_id, `cy-morph-${sha(key).slice(0, 20)}`, `Unstable morpheme ID for ${key}`);
    assert.ok(!morphemeByKey.has(key), `Duplicate morpheme key: ${key}`);
    assert.ok(!morphemeById.has(row.root_id), `Duplicate root_id: ${row.root_id}`);
    assert.equal(row.review_status, "reviewed", `Unreviewed morpheme: ${key}`);
    parseJsonArray(row.variant_forms_json, `${key} variant_forms_json`);
    const refs = parseJsonArray(row.evidence_refs, `${key} evidence_refs`);
    assert.ok(refs.length > 0, `Morpheme has no evidence: ${key}`);
    for (const ref of refs) assert.ok(evidenceById.has(ref), `Unknown evidence ${ref} on ${key}`);
    morphemeByKey.set(key, row);
    morphemeById.set(row.root_id, row);
  }

  const entries = [];
  const seenBatches = new Set();
  for (const batch of batches) {
    assert.match(batch.batchId, /^cet4-s2-b\d{3}$/u, "Invalid batch ID");
    assert.ok(!seenBatches.has(batch.batchId), `Duplicate batch ${batch.batchId}`);
    seenBatches.add(batch.batchId);
    assert.equal(batch.stage, 2, `${batch.batchId} has the wrong stage`);
    assert.equal(batch.status, "reviewed", `${batch.batchId} is not reviewed`);
    assert.ok(batch.entries.length >= 5 && batch.entries.length <= 10, `${batch.batchId} must contain 5-10 entries`);
    entries.push(...batch.entries.map((entry) => ({ ...entry, batchId: batch.batchId })));
  }
  assert.equal(entries.length, 30, "Stage 2 sample must contain exactly 30 entries");

  const entryBySpelling = new Map();
  for (const entry of entries) {
    const spellingKey = normalizeForLookup(entry.spelling);
    const frozen = wordBySpelling.get(spellingKey);
    assert.ok(frozen, `Sample word is not in the frozen list: ${entry.spelling}`);
    assert.ok(!entryBySpelling.has(spellingKey), `Duplicate sample spelling: ${entry.spelling}`);
    assert.equal(entry.wordId, frozen.word_id, `Wrong frozen word ID for ${entry.spelling}`);
    assert.equal(entry.wordOrder, Number(frozen.word_order), `Wrong frozen word order for ${entry.spelling}`);
    assert.deepEqual(entry.variants, JSON.parse(frozen.variants_json), `Wrong variants for ${entry.spelling}`);
    for (const field of ["pronunciation", "definitionCn", "memoryMarkup", "etymologyMarkup", "rootAffixNotes"]) {
      requiredText(entry[field], `${entry.spelling}.${field}`);
    }
    assert.ok(Array.isArray(entry.morphemes), `${entry.spelling}.morphemes must be an array`);
    if (entry.morphemes.length === 0) {
      assert.match(entry.rootAffixNotes, /整体/u, `${entry.spelling} needs an explicit whole-word note`);
    }
    const localMorphemes = new Set();
    for (const part of entry.morphemes) {
      requiredText(part.key, `${entry.spelling}.morpheme.key`);
      requiredText(part.spelling, `${entry.spelling}.morpheme.spelling`);
      assert.ok(morphemeByKey.has(part.key), `Unknown morpheme ${part.key} on ${entry.spelling}`);
      assert.ok(!localMorphemes.has(part.key), `Duplicate morpheme ${part.key} on ${entry.spelling}`);
      localMorphemes.add(part.key);
    }
    assert.ok(Array.isArray(entry.examples) && entry.examples.length > 0, `${entry.spelling} has no ordinary example`);
    assert.ok(Array.isArray(entry.collocations) && entry.collocations.length > 0, `${entry.spelling} has no collocation`);
    assert.ok(Array.isArray(entry.longSentences) && entry.longSentences.length > 0, `${entry.spelling} has no long sentence`);
    assert.ok(Array.isArray(entry.relations), `${entry.spelling}.relations must be an array`);
    assert.ok(Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.length >= 2, `${entry.spelling} needs lexical and editorial evidence`);
    const entryEvidence = [];
    for (const ref of entry.evidenceRefs) {
      const source = evidenceById.get(ref);
      assert.ok(source, `Unknown evidence ${ref} on ${entry.spelling}`);
      assert.equal(source.review_status, "reviewed", `Unreviewed evidence ${ref}`);
      entryEvidence.push(source);
    }
    assert.ok(entryEvidence.some((source) => source.subject_id === entry.wordId && source.field_group === "base"),
      `${entry.spelling} has no word-specific lexical evidence`);
    assert.ok(entryEvidence.some((source) => source.subject_id === entry.batchId && source.origin === "cyword_original"),
      `${entry.spelling} has no batch editorial evidence`);

    for (const example of entry.examples) {
      for (const field of ["sentence", "translation", "matchedSurface", "contextExplanation", "difficultyRationale"]) {
        requiredText(example[field], `${entry.spelling}.example.${field}`);
      }
      assert.ok(normalizeForLookup(example.sentence).includes(normalizeForLookup(example.matchedSurface)),
        `${entry.spelling} example does not contain matchedSurface`);
    }
    for (const collocation of entry.collocations) {
      for (const field of ["phrase", "meaning", "example"]) requiredText(collocation[field], `${entry.spelling}.collocation.${field}`);
    }
    for (const relation of entry.relations) {
      assert.ok(RELATION_TYPES.has(relation.type), `Invalid relation type on ${entry.spelling}`);
      assert.ok(Array.isArray(relation.words) && relation.words.length > 0, `Empty relation group on ${entry.spelling}`);
      for (const related of relation.words) {
        requiredText(related.spelling, `${entry.spelling}.relation.spelling`);
        requiredText(related.displayText, `${entry.spelling}.relation.displayText`);
        requiredText(related.meaning, `${entry.spelling}.relation.meaning`);
      }
    }
    assert.equal(new Set(entry.relations.map((relation) => relation.type)).size, entry.relations.length,
      `Duplicate relation type on ${entry.spelling}`);
    for (const longSentence of entry.longSentences) {
      for (const field of ["sentence", "translation", "difficultyBand", "sentenceDifficulty", "targetSurface", "targetSense"]) {
        requiredText(longSentence[field], `${entry.spelling}.longSentence.${field}`);
      }
      assert.ok(normalizeForLookup(longSentence.sentence).includes(normalizeForLookup(longSentence.targetSurface)),
        `${entry.spelling} long sentence does not contain targetSurface`);
      assert.ok(Array.isArray(longSentence.segments) && longSentence.segments.length >= 3,
        `${entry.spelling} long sentence needs at least three segments`);
      assert.equal(longSentence.segments.map((segment) => segment.text).join(""), longSentence.sentence,
        `${entry.spelling} long sentence segments do not reconstruct the sentence`);
      longSentence.segments.forEach((segment, index) => {
        assert.ok(SEGMENT_ROLES.has(segment.role), `${entry.spelling} segment ${index} has invalid role`);
        requiredText(segment.roleLabel, `${entry.spelling}.segment.${index}.roleLabel`);
        requiredText(segment.text, `${entry.spelling}.segment.${index}.text`);
        requiredText(segment.gloss, `${entry.spelling}.segment.${index}.gloss`);
        assert.ok(Number.isInteger(segment.level) && segment.level >= 0, `${entry.spelling} segment ${index} has invalid level`);
        assert.equal(typeof segment.spine, "boolean", `${entry.spelling} segment ${index} has invalid spine`);
      });
      assert.ok(Number.isInteger(longSentence.targetSegment) && longSentence.segments[longSentence.targetSegment],
        `${entry.spelling} has invalid targetSegment`);
      assert.ok(normalizeForLookup(longSentence.segments[longSentence.targetSegment].text)
        .includes(normalizeForLookup(longSentence.targetSurface)), `${entry.spelling} targetSegment misses targetSurface`);
      assert.ok(Array.isArray(longSentence.analyses) && longSentence.analyses.length >= 2,
        `${entry.spelling} long sentence needs at least two analyses`);
      assert.ok(longSentence.analyses.some((item) => item.sectionKind === "structure"), `${entry.spelling} needs a structure analysis`);
      assert.ok(longSentence.analyses.some((item) => item.sectionKind === "target"), `${entry.spelling} needs a target analysis`);
      for (const analysis of longSentence.analyses) {
        assert.ok(ANALYSIS_KINDS.has(analysis.sectionKind), `Invalid analysis kind on ${entry.spelling}`);
        for (const field of ["dimension", "keyword", "analysisText"]) requiredText(analysis[field], `${entry.spelling}.analysis.${field}`);
        assert.ok(Array.isArray(analysis.refs) && analysis.refs.length > 0, `${entry.spelling} analysis has no refs`);
        for (const ref of analysis.refs) assert.ok(Number.isInteger(ref) && longSentence.segments[ref], `${entry.spelling} analysis has invalid ref ${ref}`);
        if (analysis.examples != null) {
          assert.ok(Array.isArray(analysis.examples), `${entry.spelling} analysis examples must be an array`);
          for (const pair of analysis.examples) assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every((item) => typeof item === "string" && item.trim()), `${entry.spelling} analysis has an invalid transfer example`);
        }
      }
    }
    entryBySpelling.set(spellingKey, entry);
  }

  for (const entry of entries) {
    for (const relation of entry.relations) {
      for (const related of relation.words) {
        assert.ok(entryBySpelling.has(normalizeForLookup(related.spelling)),
          `Relation from ${entry.spelling} targets a word outside the compiled sample: ${related.spelling}`);
      }
    }
    for (const field of WORD_LINK_FIELDS) {
      const links = extractMarkup(entry[field]);
      const remainder = entry[field].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, "");
      assert.ok(!remainder.includes("[[") && !remainder.includes("]]"), `Malformed markup in ${entry.spelling}.${field}`);
      for (const link of links) {
        if (link.identifier.startsWith("word:")) {
          const target = link.identifier.slice(5);
          assert.ok(entryBySpelling.has(normalizeForLookup(target)), `Unknown sample word link ${link.identifier}`);
        } else if (link.identifier.startsWith("morph:")) {
          assert.ok(morphemeByKey.has(link.identifier), `Unknown morpheme link ${link.identifier}`);
        } else {
          assert.fail(`Unsupported markup identifier ${link.identifier} on ${entry.spelling}`);
        }
      }
    }
  }

  const actualSpellings = entries.map((entry) => entry.spelling);
  assert.deepEqual(actualSpellings, manifest.selectedWords, "Batch order differs from sample manifest");
  const covered = new Set(Object.values(manifest.coverage).flat());
  for (const spelling of actualSpellings) assert.ok(covered.has(spelling), `Selection coverage is not documented for ${spelling}`);
  for (const [category, spellings] of Object.entries(manifest.coverage)) {
    assert.ok(spellings.length > 0, `Empty coverage category: ${category}`);
    for (const spelling of spellings) assert.ok(entryBySpelling.has(normalizeForLookup(spelling)), `Coverage names unselected word ${spelling}`);
  }

  const progressById = new Map(progress.map((row) => [row.word_id, row]));
  assert.equal(progressById.size, wordlist.length, "Progress ledger no longer covers the frozen wordlist");
  for (const entry of entries) {
    const row = progressById.get(entry.wordId);
    assert.ok(row, `Missing progress row for ${entry.spelling}`);
    assert.equal(row.base_status, "reviewed", `Base progress not reviewed for ${entry.spelling}`);
    assert.equal(row.morphology_status, "reviewed", `Morphology progress not reviewed for ${entry.spelling}`);
    assert.equal(row.sentences_status, "reviewed", `Sentence progress not reviewed for ${entry.spelling}`);
    assert.equal(row.exam_status, "not_started", `Exam progress must remain pending for ${entry.spelling}`);
    assert.equal(row.batch_id, entry.batchId, `Wrong progress batch for ${entry.spelling}`);
    assert.deepEqual(JSON.parse(row.evidence_refs), entry.evidenceRefs, `Progress evidence differs for ${entry.spelling}`);
  }
  const selectedIds = new Set(entries.map((entry) => entry.wordId));
  const draftPath = path.join(authoringDir, "content");
  const drafts = fs.existsSync(draftPath)
    ? new Map(loadDrafts().entries.map((entry) => [entry.wordId, entry]))
    : new Map();
  for (const id of drafts.keys()) assert.ok(!selectedIds.has(id), `Draft duplicates a sample word: ${id}`);
  for (const row of progress) {
    if (selectedIds.has(row.word_id)) continue;
    if (drafts.has(row.word_id)) {
      // 新批次必须有逐词正文，且进度只能等于其真实草稿状态；不能借此放行任意进度。
      for (const [field, value] of Object.entries(expectedDraftProgress(drafts.get(row.word_id)))) {
        assert.equal(row[field], value, `Draft progress differs for ${row.spelling}.${field}`);
      }
      continue;
    }
    assert.deepEqual(
      [row.base_status, row.morphology_status, row.sentences_status, row.exam_status],
      ["not_started", "not_started", "not_started", "not_started"],
      `Unselected word has advanced progress: ${row.spelling}`,
    );
    assert.equal(row.batch_id, "", `Unselected word has a batch: ${row.spelling}`);
  }
  const ledgerById = new Map(batchLedger.map((row) => [row.batch_id, row]));
  assert.equal(ledgerById.size, batches.length, "Batch ledger count differs from source batches");
  for (const batch of batches) {
    const ledger = ledgerById.get(batch.batchId);
    assert.ok(ledger, `Missing batch ledger row for ${batch.batchId}`);
    assert.equal(ledger.stage, "2", `Wrong ledger stage for ${batch.batchId}`);
    assert.equal(ledger.status, "reviewed", `Unreviewed ledger batch ${batch.batchId}`);
    assert.deepEqual(JSON.parse(ledger.word_ids_json), batch.entries.map((entry) => entry.wordId), `Batch ledger words differ for ${batch.batchId}`);
  }

  return { entries, entryBySpelling, wordBySpelling, evidenceById, morphemeByKey, morphemeById };
}

function markupTarget(identifier, context) {
  if (identifier.startsWith("word:")) {
    const spelling = identifier.slice(5);
    const entry = context.entryBySpelling.get(normalizeForLookup(spelling));
    return { target_type: "word", target_id: entry.wordId };
  }
  const row = context.morphemeByKey.get(identifier);
  return { target_type: row.root_type, target_id: row.root_id };
}

function buildInventory(entries) {
  const fields = new Map();
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      const fieldPath = `entries[].${key}`;
      const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
      const current = fields.get(fieldPath) ?? { field_path: fieldPath, types: new Set(), occurrences: 0, non_null_occurrences: 0 };
      current.types.add(type);
      current.occurrences += 1;
      if (value != null && value !== "") current.non_null_occurrences += 1;
      fields.set(fieldPath, current);
    }
  }
  return [...fields.values()].sort((a, b) => a.field_path.localeCompare(b.field_path)).map((row) => ({
    field_path: row.field_path,
    observed_types: [...row.types].sort().join("|"),
    occurrences: row.occurrences,
    non_null_occurrences: row.non_null_occurrences,
  }));
}

export function buildSample(data, validatedContext) {
  const context = validatedContext ?? validateSource(data);
  const { schema, fieldPolicy } = data;
  const { entries, entryBySpelling, morphemeByKey } = context;
  const tables = Object.fromEntries(Object.keys(schema.tables).map((name) => [name, []]));

  for (const policy of fieldPolicy) {
    const primaryFields = schema.tables[policy.table_file].primaryKey.split(" + ");
    tables["field_dictionary.csv"].push({
      table_file: policy.table_file,
      field_name: policy.field_name,
      category: policy.fill_method,
      data_type: policy.original_data_type,
      source_path: policy.editorial_source_path,
      description: policy.rule,
      primary_key: String(primaryFields.includes(policy.field_name)),
    });
  }

  for (const entry of entries) {
    const roots = entry.morphemes.map((part, index) => {
      const registered = morphemeByKey.get(part.key);
      return {
        word_id: entry.wordId,
        root_index: index,
        root_id: registered.root_id,
        spelling: part.spelling,
        root_type: registered.root_type,
        meaning: registered.meaning_cn,
        memory_method: part.memoryMethod ?? "",
      };
    });
    tables["root_markups.csv"].push(...roots);

    const wordLinks = [];
    const seenLinks = new Set();
    for (const field of WORD_LINK_FIELDS) {
      for (const link of extractMarkup(entry[field])) {
        if (seenLinks.has(link.identifier)) continue;
        seenLinks.add(link.identifier);
        wordLinks.push({
          word_id: entry.wordId,
          link_index: wordLinks.length,
          target_identifier: link.identifier,
          ...markupTarget(link.identifier, context),
        });
      }
    }
    tables["word_markup_links.csv"].push(...wordLinks);

    entry.examples.forEach((example, index) => tables["examples.csv"].push({
      word_id: entry.wordId,
      example_id: `${entry.wordId}:example:${String(index + 1).padStart(3, "0")}`,
      order_index: index,
      sentence: example.sentence,
      translation: example.translation,
      matched_surface: example.matchedSurface,
      context_explanation: example.contextExplanation,
      difficulty_rationale: example.difficultyRationale,
    }));

    entry.collocations.forEach((collocation, index) => tables["collocations.csv"].push({
      word_id: entry.wordId,
      collocation_id: `${entry.wordId}:collocation:${String(index + 1).padStart(3, "0")}`,
      order_index: index,
      phrase: collocation.phrase,
      meaning: collocation.meaning,
      example: collocation.example,
    }));

    entry.relations.forEach((relation, relationIndex) => {
      tables["relations.csv"].push({
        word_id: entry.wordId,
        relation_index: relationIndex,
        relation_type: relation.type,
        related_word_count: relation.words.length,
      });
      relation.words.forEach((related, relatedIndex) => {
        const target = entryBySpelling.get(normalizeForLookup(related.spelling));
        tables["relation_words.csv"].push({
          word_id: entry.wordId,
          relation_type: relation.type,
          related_index: relatedIndex,
          related_word_id: target.wordId,
          spelling: target.spelling,
          display_text: related.displayText,
          meaning: related.meaning,
        });
      });
    });

    entry.longSentences.forEach((longSentence, sentenceIndex) => {
      const id = `${entry.wordId}:long:${String(sentenceIndex + 1).padStart(3, "0")}`;
      tables["long_sentences.csv"].push({
        word_id: entry.wordId,
        long_sentence_id: id,
        order_index: sentenceIndex,
        sentence: longSentence.sentence,
        translation: longSentence.translation,
        difficulty_band: longSentence.difficultyBand,
        sentence_difficulty: longSentence.sentenceDifficulty,
        target_word: entry.spelling,
        target_sense: longSentence.targetSense,
        source_note: "cyword_original",
        reader_parse_version: 1,
        reader_parse_target_ref: longSentence.targetSegment,
      });
      longSentence.segments.forEach((segment, segmentIndex) => tables["long_sentence_segments.csv"].push({
        word_id: entry.wordId,
        long_sentence_id: id,
        segment_index: segmentIndex,
        role: segment.role,
        role_label: segment.roleLabel,
        text: segment.text,
        gloss: segment.gloss,
        level: segment.level,
        spine: String(segment.spine),
      }));
      const sectionIndexes = new Map();
      const itemCounts = new Map();
      for (const analysis of longSentence.analyses) {
        if (!sectionIndexes.has(analysis.sectionKind)) sectionIndexes.set(analysis.sectionKind, sectionIndexes.size);
        const itemIndex = itemCounts.get(analysis.sectionKind) ?? 0;
        itemCounts.set(analysis.sectionKind, itemIndex + 1);
        tables["long_sentence_analysis.csv"].push({
          word_id: entry.wordId,
          long_sentence_id: id,
          section_index: sectionIndexes.get(analysis.sectionKind),
          section_kind: analysis.sectionKind,
          item_index: itemIndex,
          dimension: analysis.dimension,
          keyword: analysis.keyword,
          refs_json: JSON.stringify(analysis.refs),
          analysis_text: analysis.analysisText,
          examples_json: analysis.examples ? JSON.stringify(analysis.examples) : "",
        });
      }
    });

    const counts = {
      examples: entry.examples.length,
      long: entry.longSentences.length,
      exams: 0,
      collocations: entry.collocations.length,
      roots: roots.length,
      relations: entry.relations.length,
      links: wordLinks.length,
    };
    tables["sentence_zones.csv"].push({
      word_id: entry.wordId,
      book_id: "cyword-cet4",
      status: "ready",
      contract_source: "cyword_original",
      requires_membership: "false",
      no_auto_fallback: "true",
      example_count: counts.examples,
      long_sentence_count: counts.long,
      exam_example_count: counts.exams,
    });
    tables["words.csv"].push({
      word_id: entry.wordId,
      book_id: "cyword-cet4",
      book_code: "cet4",
      book_name: "大学英语四级（30 词样板）",
      day_id: "",
      day_number: "",
      order_in_day: "",
      word_order: entry.wordOrder,
      spelling: entry.spelling,
      pronunciation: entry.pronunciation,
      definition_cn: entry.definitionCn,
      audio_url: "",
      memory_markup: entry.memoryMarkup,
      etymology_markup: entry.etymologyMarkup,
      root_affix_notes: entry.rootAffixNotes,
      root_affix_accumulation: entry.rootAffixAccumulation ?? "",
      vocabulary_id: "",
      is_completed: "false",
      studied: "false",
      reviewed: "false",
      memorized_count: 0,
      reviewed_count: 0,
      sentence_zone_status: "ready",
      example_count: counts.examples,
      long_sentence_count: counts.long,
      exam_example_count: counts.exams,
      frequency_count: 0,
      collocation_count: counts.collocations,
      root_markup_count: counts.roots,
      relation_group_count: counts.relations,
      analysis_seen_mark_count: 0,
      access_allowed: "true",
      access_reason: "",
      permission_type: "",
      permission_is_expired: "false",
      protection_content_type: "",
      protection_exposure_weight: "",
      protection_trace_id: "",
      protection_marker_type: "",
      protection_marker_version: "",
      protection_hidden_prompt: "",
      detail_status: "ok",
    });
  }

  tables["raw_field_inventory.csv"] = buildInventory(entries);
  const roots = tables["root_markups.csv"];
  const trueRoots = roots.filter((row) => row.root_type === "root");
  const trueRootIds = new Set(trueRoots.map((row) => row.root_id));
  const rootedWords = new Set(trueRoots.map((row) => row.word_id));
  const rootsByWord = new Map();
  const wordsByRoot = new Map();
  for (const row of trueRoots) {
    if (!rootsByWord.has(row.word_id)) rootsByWord.set(row.word_id, new Set());
    if (!wordsByRoot.has(row.root_id)) wordsByRoot.set(row.root_id, new Set());
    rootsByWord.get(row.word_id).add(row.root_id);
    wordsByRoot.get(row.root_id).add(row.word_id);
  }
  const soloWords = entries.length - rootedWords.size;
  const rootAppearances = [...wordsByRoot.values()].reduce((sum, values) => sum + values.size, 0);
  const statistics = {
    metadataWords: entries.length,
    uniqueWords: entries.length,
    metadataDifference: 0,
    rootMarkupRows: roots.length,
    trueRoots: trueRootIds.size,
    wordsWithTrueRoot: rootedWords.size,
    soloWords,
    multiRootWords: [...rootsByWord.values()].filter((values) => values.size > 1).length,
    studyGroups: trueRootIds.size + soloWords,
    studyAppearances: rootAppearances + soloWords,
    largestTrueRootGroup: Math.max(...[...wordsByRoot.values()].map((values) => values.size)),
    ordinaryExamples: tables["examples.csv"].length,
    examExamples: 0,
    longSentences: tables["long_sentences.csv"].length,
    collocations: tables["collocations.csv"].length,
    frequencies: 0,
  };
  tables["books.csv"].push({
    book_id: "cyword-cet4",
    book_code: "cet4",
    book_name: "大学英语四级（30 词样板）",
    target_exam: "cet4",
    total_words_metadata: entries.length,
    enumerated_unique_words: entries.length,
    metadata_difference: 0,
    root_count: new Set(roots.map((row) => row.root_id)).size,
    purchase_status: "not_applicable",
    lifecycle_status: "stage2_sample",
    is_active: "false",
    currently_available: "false",
    current_period_ends_at: "",
    final_ends_at: "",
  });

  for (const [name, table] of Object.entries(schema.tables)) {
    tables["table_catalog.csv"].push({
      table_file: name,
      row_count: name === "table_catalog.csv" ? Object.keys(schema.tables).length : tables[name].length,
      primary_key: table.primaryKey,
      description: `四级阶段 2 样板：${name}`,
    });
  }

  const canonicalFiles = Object.keys(schema.tables).sort();
  const book = {
    schemaVersion: 1,
    code: "cet4",
    name: "大学英语四级（30 词样板）",
    targetExam: "cet4",
    contentScope: "stage2_sample",
    wordlistVersion: data.manifest.wordlistVersion,
    statistics,
    planning: {
      targetStudyAppearancesPerDay: 190,
      grouping: "true-root-or-solo",
      cycle: "study-study-study-review",
      note: "阶段 2 样板只验证分组和读取，不冻结全量学习天数。",
    },
    canonicalFiles,
  };
  return { tables, book, context };
}

export function writeSample(data, outputDir = sampleBookDir) {
  const built = buildSample(data);
  const csvDir = path.join(outputDir, "csv");
  fs.mkdirSync(csvDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "book.json"), `${JSON.stringify(built.book, null, 2)}\n`, "utf8");
  for (const name of built.book.canonicalFiles) {
    fs.writeFileSync(path.join(csvDir, name), serializeCsv(data.schema.tables[name].columns, built.tables[name]), "utf8");
  }
  return built;
}

export function validateGenerated(data, built, outputDir = sampleBookDir) {
  const csvDir = path.join(outputDir, "csv");
  assert.deepEqual(fs.readdirSync(csvDir).filter((name) => name.endsWith(".csv")).sort(), built.book.canonicalFiles);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, "book.json"), "utf8")), built.book, "Stale sample book manifest");
  const parsed = {};
  for (const name of built.book.canonicalFiles) {
    const expected = serializeCsv(data.schema.tables[name].columns, built.tables[name]);
    const actual = fs.readFileSync(path.join(csvDir, name), "utf8");
    assert.equal(actual, expected, `Stale generated table: ${name}`);
    const read = readCsvWithHeader(path.join(csvDir, name));
    assert.deepEqual(read.header, data.schema.tables[name].columns, `Wrong header: ${name}`);
    parsed[name] = read.rows.map((values) => Object.fromEntries(read.header.map((column, index) => [column, values[index] ?? ""])));
    const keyFields = data.schema.tables[name].primaryKey.split(" + ");
    const keys = parsed[name].map((row) => keyFields.map((field) => row[field]).join("\u0000"));
    assert.equal(new Set(keys).size, keys.length, `Duplicate primary key in ${name}`);
  }
  const wordIds = new Set(parsed["words.csv"].map((row) => row.word_id));
  const rootIds = new Set(parsed["root_markups.csv"].map((row) => row.root_id));
  for (const name of ["sentence_zones.csv", "examples.csv", "long_sentences.csv", "long_sentence_segments.csv", "long_sentence_analysis.csv", "collocations.csv", "word_markup_links.csv", "root_markups.csv", "relations.csv", "relation_words.csv"]) {
    for (const row of parsed[name]) assert.ok(wordIds.has(row.word_id), `Orphan word_id in ${name}: ${row.word_id}`);
  }
  for (const row of parsed["relation_words.csv"]) assert.ok(wordIds.has(row.related_word_id), `Orphan related_word_id: ${row.related_word_id}`);
  for (const row of parsed["word_markup_links.csv"]) {
    const targets = row.target_type === "word" ? wordIds : rootIds;
    assert.ok(targets.has(row.target_id), `Orphan markup target: ${row.target_id}`);
  }
  for (const row of parsed["long_sentence_analysis.csv"]) JSON.parse(row.refs_json);
  const catalog = new Map(parsed["table_catalog.csv"].map((row) => [row.table_file, Number(row.row_count)]));
  for (const name of built.book.canonicalFiles) assert.equal(catalog.get(name), parsed[name].length, `Catalog count mismatch for ${name}`);
  assert.ok(parsed["words.csv"].every((row) => row.detail_status === "ok" && row.sentence_zone_status === "ready"));
  return { canonicalTables: built.book.canonicalFiles.length, words: wordIds.size, roots: rootIds.size };
}
