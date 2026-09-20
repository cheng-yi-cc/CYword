import assert from "node:assert/strict";
import test from "node:test";
import { readLocalBook } from "../scripts/local-book-preview.ts";
import type { Catalog, WordsResponse } from "../src/types.ts";

test("local preview serves compiled guides with version and ID validation", async () => {
  const catalog = await readLocalBook("data") as Catalog;
  const id = Object.values(catalog.words).find(word => word.spelling === "symposium")!.id;
  const request = { dataVersion: catalog.dataVersion, planDay: 1, kind: "study" as const, wordIds: [id, id] };
  const result = await readLocalBook("data", request) as WordsResponse;
  assert.equal(result.wordCount, 1);
  assert.equal(result.words[id].pronunciationGuide?.chunks.map(chunk => chunk.text).join("·"), "sym·po·si·um");
  await assert.rejects(readLocalBook("data", { ...request, dataVersion: "stale" }), /重新编译/);
  await assert.rejects(readLocalBook("data", { ...request, wordIds: ["../../package"] }), /未知单词/);
  await assert.rejects(readLocalBook("data", { ...request, wordIds: ["__proto__"] }), /未知单词/);
});
