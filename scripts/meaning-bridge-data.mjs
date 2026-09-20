import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const semanticTypes = new Set(["near_synonym", "synonym", "antonym"]);
export const bridgeHash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bridgeWordSource = word => ({ wordId: word.word_id, spelling: word.spelling, definition: word.definition_cn });

// 原表的类型与原文只作为待审候选；绝不直接变成界面提示。
export function collectBridgeCandidates(words, relations) {
  const byId = new Map(words.map(word => [word.word_id, word]));
  const bySpelling = new Map(words.map(word => [word.spelling.toLowerCase(), word]));
  const pairs = new Map();
  const excluded = new Map(words.map(word => [word.word_id, []]));
  for (const row of relations) {
    const owner = byId.get(row.word_id);
    if (!owner) throw new Error("Meaning bridge relation has unknown owner");
    const anchor = byId.get(row.related_word_id) ?? bySpelling.get(row.spelling.toLowerCase());
    if (!semanticTypes.has(row.relation_type) || !anchor || anchor.word_id === owner.word_id) {
      excluded.get(owner.word_id).push({ source: row, reason: !semanticTypes.has(row.relation_type) ? "not-semantic-relation" : !anchor ? "outside-book" : "self-reference" });
      continue;
    }
    if (anchor.spelling.toLowerCase() !== row.spelling.toLowerCase()) throw new Error("Meaning bridge anchor ID/spelling mismatch");
    const wordIds = [owner.word_id, anchor.word_id].sort();
    const pairId = wordIds.join(":");
    if (!pairs.has(pairId)) pairs.set(pairId, { pairId, wordIds, sources: [] });
    pairs.get(pairId).sources.push(row);
  }
  return { pairs, excluded, byId };
}

function readLines(bookDir, filename) {
  if (!/^enhancements\/[a-z-]+\.jsonl$/.test(filename)) throw new Error("Invalid meaning bridge filename");
  return fs.readFileSync(path.join(bookDir, filename), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

export function validateBridgeReviews(words, relations, reviews) {
  const { pairs, excluded, byId } = collectBridgeCandidates(words, relations);
  const reviewed = new Map();
  for (const review of reviews) {
    const fail = message => { throw new Error(`${review.pairId}: ${message}`); };
    if (!Array.isArray(review.wordIds) || review.wordIds.length !== 2 || new Set(review.wordIds).size !== 2 || review.wordIds.some(id => !byId.has(id))) fail("invalid bridge endpoints");
    if (review.pairId !== [...review.wordIds].sort().join(":")) fail("invalid pair ID");
    if (reviewed.has(review.pairId)) fail("duplicate bridge review");
    if (!['accepted', 'rejected'].includes(review.status) || review.method !== "pair-by-pair-definition-review") fail("missing semantic review");
    if (bridgeHash(review.wordIds.map(id => bridgeWordSource(byId.get(id)))) !== review.sourceWordsSha256) fail("stale bridge definitions");
    const original = pairs.get(review.pairId);
    if (original) {
      if (bridgeHash(original.sources) !== bridgeHash(review.sources)) fail("stale source relations");
    } else if (!["curated-example", "book-definition-review"].includes(review.origin) || review.sources?.length !== 0 || !review.sourceNote) fail("untraceable additional bridge");
    if (review.status === "accepted") {
      if (!['near_synonym', 'antonym'].includes(review.relation) || typeof review.explanation !== "string" || !review.explanation.trim()) fail("invalid accepted explanation");
      if (original && original.sources.some(row => (row.relation_type === "antonym" ? "antonym" : "near_synonym") !== review.relation)) fail("conflicting relation labels require rejection");
      if (review.wordIds.some(id => !review.explanation.toLowerCase().includes(byId.get(id).spelling.toLowerCase()))) fail("explanation must name both words");
    } else if (!review.reason?.trim()) fail("rejection requires reason");
    reviewed.set(review.pairId, review);
  }
  if ([...pairs.keys()].some(id => !reviewed.has(id))) throw new Error("Unreviewed meaning bridge candidate");
  return { pairs, excluded, byId, reviewed };
}

// 每个词都留下一条处理记录，包括没有合格关系的词；空白绝不编造内容。
export function compileBridgeRecords(words, relations, reviews) {
  const { excluded, reviewed, byId } = validateBridgeReviews(words, relations, reviews);
  const reviewsByWord = new Map(words.map(word => [word.word_id, []]));
  for (const review of reviewed.values()) for (const id of review.wordIds) reviewsByWord.get(id).push(review);
  return words.map(word => {
    const related = reviewsByWord.get(word.word_id).sort((a, b) => a.pairId.localeCompare(b.pairId));
    const bridges = related.filter(review => review.status === "accepted").map(review => {
      const anchorId = review.wordIds.find(id => id !== word.word_id);
      return { pairId: review.pairId, anchorId, anchorSpelling: byId.get(anchorId).spelling, relation: review.relation, explanation: review.explanation };
    });
    return {
      wordId: word.word_id, spelling: word.spelling,
      sourceSha256: bridgeHash({ word: bridgeWordSource(word), excluded: excluded.get(word.word_id), reviews: related }),
      disposition: bridges.length ? "has-reviewed-candidates" : "no-suitable-candidate",
      reviewedPairIds: related.map(review => review.pairId),
      excludedRelations: excluded.get(word.word_id).map(item => ({ type: item.source.relation_type, spelling: item.source.spelling, reason: item.reason })),
      bridges,
    };
  });
}

export function loadMeaningBridges(bookDir, manifest, words, relations) {
  if (!manifest.meaningBridgeEnhancement) return new Map();
  const config = manifest.meaningBridgeEnhancement;
  if (config.schemaVersion !== 1 || config.wordCount !== words.length) throw new Error("Meaning bridge manifest coverage mismatch");
  const reviews = readLines(bookDir, config.reviewFile);
  const records = readLines(bookDir, config.recordsFile);
  const expected = compileBridgeRecords(words, relations, reviews);
  if (bridgeHash(records) !== bridgeHash(expected)) throw new Error("Missing, stale or altered per-word meaning bridge records");
  const wordReviews = readLines(bookDir, config.wordReviewFile);
  const wordReviewMap = new Map(wordReviews.map(row => [row.wordId, row]));
  if (wordReviews.length !== words.length || wordReviewMap.size !== words.length) throw new Error("Missing whole-book definition review");
  for (const record of records) {
    const review = wordReviewMap.get(record.wordId);
    if (review?.method !== "whole-book-definition-pass" || review.recordSha256 !== bridgeHash(record) || !review.note?.trim()) throw new Error(`${record.spelling}: stale whole-book definition review`);
  }
  return new Map(records.map(record => [record.wordId, record.bridges]));
}
