// 只生成候选。更新正式数据时需复核候选，并更新相应逐词验收记录。
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { align, chunkAlignment, normalizeIpa } from "./pronunciation-alignment.mjs";

const bookCode = process.env.CYWORD_BOOK ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(bookCode)) throw new Error("Invalid book code");
const dir = path.resolve("books", bookCode);
const words = parse(fs.readFileSync(path.join(dir, "csv/words.csv"), "utf8"), { columns: true, bom: true });
const records = words.map(word => {
  const ipa = normalizeIpa(word.pronunciation);
  const candidate = align(word.spelling, ipa);
  return { wordId: word.word_id, spelling: word.spelling, sourcePronunciation: word.pronunciation,
    status: "needs-review", cost: candidate?.cost ?? null,
    chunks: candidate ? chunkAlignment(candidate, ipa) : null };
});
const out = path.resolve(".work/pronunciation", `${bookCode}-candidates.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(records, null, 2));
console.log(`Generated ${records.length} unreviewed candidates: ${out}`);
