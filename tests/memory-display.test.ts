import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { wordMemoryDisplay } from "../src/memory-display.ts";

test("word display hides only the agreed lead-in and preserves original text and references", () => {
  const rows = parse(readFileSync(new URL("../books/cet6/csv/words.csv", import.meta.url), "utf8"), { columns: true, bom: true });
  const word = rows.find((row: Record<string, string>) => row.spelling === "symposium");
  assert.ok(word);
  const original = word.memory_markup;
  assert.ok(original.includes("针对第 1 个元素采用词根词缀分析："));
  const displayed = wordMemoryDisplay(original)!;
  assert.ok(!displayed.includes("针对第"));
  assert.deepEqual(displayed.match(/\[\[.*?\]\]/g), original.match(/\[\[.*?\]\]/g));
  assert.equal(displayed, original.replaceAll(/针对第 [123] 个元素采用词根词缀分析：/g, ""));
  assert.equal(word.memory_markup, original);
  const other = "针对整个单词采用谐音记忆法：land 的发音类似……\n含义中提到针对第 1 个元素采用词根词缀分析：不应删去。";
  assert.equal(wordMemoryDisplay(other), other);
});
