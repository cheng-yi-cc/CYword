import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function pronunciationHash(guide) {
  return crypto.createHash("sha256").update(JSON.stringify(guide)).digest("hex");
}

function readLines(bookDir, filename) {
  if (!/^enhancements\/[a-z-]+\.jsonl$/.test(filename)) throw new Error("Invalid enhancement filename");
  return fs.readFileSync(path.join(bookDir, filename), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

export function loadPronunciationGuides(bookDir, manifest, words) {
  if (!manifest.pronunciationEnhancement) return new Map();
  const config = manifest.pronunciationEnhancement;
  if (config.schemaVersion !== 1 || config.wordCount !== words.length) throw new Error("Pronunciation coverage manifest mismatch");
  const records = readLines(bookDir, config.guidesFile);
  const reviews = readLines(bookDir, config.reviewFile);
  const byId = new Map(words.map(word => [word.word_id, word]));
  const reviewMap = new Map(reviews.map(review => [review.wordId, review]));
  if (reviews.length !== words.length || reviewMap.size !== words.length) throw new Error("Pronunciation review coverage mismatch");
  const result = new Map();
  for (const record of records) {
    const word = byId.get(record.wordId);
    const fail = message => { throw new Error(`${record.spelling ?? record.wordId}: ${message}`); };
    if (!word || result.has(record.wordId)) fail("unknown or duplicate pronunciation word");
    if (record.spelling !== word.spelling || record.sourcePronunciation !== word.pronunciation) fail("stale pronunciation source");
    const guide = record.guide;
    if (!guide || !/^\/[^/]+\/$/.test(guide.pronunciation) || !Array.isArray(guide.chunks) || !guide.chunks.length) fail("invalid guide");
    if (!guide.chunks.every(chunk => typeof chunk.text === "string" && chunk.text.length && typeof chunk.ipa === "string" && chunk.ipa.length && !/[\/ˈˌ]/.test(chunk.ipa) && ["none", "primary", "secondary"].includes(chunk.stress))) fail("invalid pronunciation chunk");
    if (guide.chunks.map(chunk => chunk.text).join("") !== word.spelling) fail("spelling does not round-trip");
    if (guide.chunks.map(chunk => chunk.ipa).join("") !== guide.pronunciation.slice(1, -1).replace(/[ˈˌ]/g, "")) fail("IPA does not round-trip");
    for (const [symbol, kind] of [["ˈ", "primary"], ["ˌ", "secondary"]]) {
      if (guide.pronunciation.split(symbol).length - 1 !== guide.chunks.filter(chunk => chunk.stress === kind).length) fail("stress coverage mismatch");
    }
    let soundOffset = 0;
    const rawIpa = guide.pronunciation.slice(1, -1);
    for (let i = 0; i < rawIpa.length; i++) {
      const symbol = rawIpa[i];
      if (symbol !== "ˈ" && symbol !== "ˌ") { soundOffset++; continue; }
      const nextVowel = rawIpa.slice(i + 1).replace(/[ˈˌ]/g, "").search(/[æɑɒɔeɛəɜɝɚɪiʊuʌao]/);
      if (nextVowel < 0) fail("stress without a vowel");
      const at = soundOffset + nextVowel;
      let end = 0;
      const owner = guide.chunks.find(chunk => { end += chunk.ipa.length; return at < end; });
      if (owner?.stress !== (symbol === "ˈ" ? "primary" : "secondary")) fail("stress assigned to wrong spelling chunk");
    }
    if (!Array.isArray(guide.notes) || !guide.notes.every(note => typeof note === "string" && note.length > 0)) fail("invalid spelling notes");
    if (record.correction && (!record.correction.reason || !/^https:\/\//.test(record.correction.source))) fail("correction without evidence");
    const review = reviewMap.get(record.wordId);
    if (!review || review.guideSha256 !== pronunciationHash(record) || review.status !== "accepted" || review.method !== "alignment-and-exception-review") fail("missing or stale per-word acceptance");
    result.set(record.wordId, guide);
  }
  if (result.size !== words.length) throw new Error(`Pronunciation coverage: ${result.size}/${words.length}`);
  return result;
}
