import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const bookCode = process.env.CYWORD_BOOK ?? process.argv[2] ?? "cet6";
const bucket = process.env.CYWORD_BOOK_BUCKET ?? "cyword-book-data";
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(bookCode)) throw new Error(`Invalid book code: ${bookCode}`);
if (!/^[a-z0-9][a-z0-9-]*$/u.test(bucket)) throw new Error(`Invalid bucket name: ${bucket}`);

const root = path.join(projectRoot, ".work", "book-api", bookCode);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "upload-manifest.json"), "utf8"));
const currentKey = `books/${bookCode}/current.json`;
const ordered = [...manifest.filter((item) => item.key !== currentKey), ...manifest.filter((item) => item.key === currentKey)];
const wrangler = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

for (const [index, item] of ordered.entries()) {
  const result = spawnSync(process.execPath, [
    wrangler,
    "r2",
    "object",
    "put",
    `${bucket}/${item.key}`,
    "--file",
    item.path,
    "--content-type",
    "application/json; charset=utf-8",
    "--remote",
  ], { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Upload failed for ${item.key}`);
  console.log(`[${index + 1}/${ordered.length}] Uploaded ${item.key}`);
}

console.log(`Published ${bookCode} data to R2 bucket ${bucket}.`);
