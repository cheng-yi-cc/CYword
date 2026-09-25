import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Catalog, WordsRequest, WordsResponse } from "../src/types.ts";

// 仅供 Vite 开发服务使用；正式安装包从 dist/book 读取完整预装词书。
const catalogs = new Map<string, { stamp: string; value: Promise<Catalog> }>();
async function localCatalog(dataDir: string): Promise<Catalog> {
  const file = path.resolve(dataDir, "catalog.json"), info = await fs.stat(file);
  const stamp = `${info.mtimeMs}:${info.size}`;
  if (catalogs.get(file)?.stamp === stamp) return catalogs.get(file)!.value;
  const value = (async () => {
    const catalog = JSON.parse(await fs.readFile(file, "utf8"));
    delete catalog.generatedAt;
    const hash = createHash("sha256").update("cyword-installed-book-v1\0").update(JSON.stringify(catalog));
    const ids = Object.keys(catalog.words).sort();
    for (let i = 0; i < ids.length; i += 64) {
      const rows = await Promise.all(ids.slice(i, i + 64).map(async id => ({ id, bytes: await fs.readFile(path.join(dataDir, "words", `${id}.json`)) })));
      for (const row of rows) hash.update(row.id).update(row.bytes);
    }
    return { ...catalog, dataVersion: hash.digest("hex").slice(0, 16) } as Catalog;
  })();
  catalogs.set(file, { stamp, value });
  try { return await value; } catch (error) { catalogs.delete(file); throw error; }
}
export async function readLocalBook(dataDir: string, request?: WordsRequest): Promise<Catalog | WordsResponse> {
  const catalog = await localCatalog(dataDir), dataVersion = catalog.dataVersion!;
  if (!request) return catalog;
  if (request.dataVersion !== dataVersion) throw new Error("本地词书已重新编译，请刷新页面");
  if (!Array.isArray(request.wordIds) || request.wordIds.length > 5166) throw new Error("词汇请求格式无效");
  const ids = [...new Set(request.wordIds)];
  if (!ids.every(id => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id) && Object.hasOwn(catalog.words, id))) {
    throw new Error("词汇请求含未知单词");
  }
  const entries = await Promise.all(ids.map(async id => [id, JSON.parse(await fs.readFile(path.join(dataDir, "words", `${id}.json`), "utf8"))]));
  return { dataVersion, wordCount: ids.length, words: Object.fromEntries(entries) };
}
