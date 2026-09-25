import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Catalog, WordsRequest, WordsResponse } from "../src/types.ts";

// 仅供 Vite 开发服务使用；正式安装包从 dist/book 读取完整预装词书。
export async function readLocalBook(dataDir: string, request?: WordsRequest): Promise<Catalog | WordsResponse> {
  const raw = await fs.readFile(path.join(dataDir, "catalog.json"), "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  const dataVersion = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  if (!request) return { ...catalog, dataVersion };
  if (request.dataVersion !== dataVersion) throw new Error("本地词书已重新编译，请刷新页面");
  if (!Array.isArray(request.wordIds) || request.wordIds.length > 5166) throw new Error("词汇请求格式无效");
  const ids = [...new Set(request.wordIds)];
  if (!ids.every(id => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id) && Object.hasOwn(catalog.words, id))) {
    throw new Error("词汇请求含未知单词");
  }
  const entries = await Promise.all(ids.map(async id => [id, JSON.parse(await fs.readFile(path.join(dataDir, "words", `${id}.json`), "utf8"))]));
  return { dataVersion, wordCount: ids.length, words: Object.fromEntries(entries) };
}
