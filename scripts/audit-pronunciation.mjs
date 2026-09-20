import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { loadPronunciationGuides } from "./pronunciation-data.mjs";

const bookCode = process.env.CYWORD_BOOK ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(bookCode)) throw new Error("Invalid book code");
const bookDir = path.resolve("books", bookCode);
const manifest = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));
const words = parse(fs.readFileSync(path.join(bookDir, "csv/words.csv"), "utf8"), { columns: true, bom: true });
const guides = loadPronunciationGuides(bookDir, manifest, words);
const result = words.map(word => {
  const guide = guides.get(word.word_id);
  if (!guide) throw new Error(`Missing pronunciation: ${word.spelling}`);
  return {
    wordId: word.word_id,
    spelling: word.spelling,
    pronunciation: guide.pronunciation,
    chunks: guide.chunks.map(chunk => `${chunk.text} /${chunk.ipa}/`).join(" | "),
    status: "pass",
  };
});
const output = path.resolve(".work/pronunciation/acceptance.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  bookCode,
  wordCount: result.length,
  checkedAt: new Date().toISOString(),
  scope: "逐词校验拼写还原、音标还原、重音覆盖、外键、来源快照和验收哈希；不等同于逐词听审录音或第三方语言学认证。",
  words: result,
}, null, 2));
console.log(`Pronunciation acceptance: ${result.length}/${words.length}; ${output}`);
