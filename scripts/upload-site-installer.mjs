import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { release } from "../website/src/release.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const file = process.argv[2];
if (!file) throw new Error("用法：npm run upload:site:installer -- <安装包路径>");
const installer = path.resolve(file);
if (path.basename(installer) !== release.filename) throw new Error("文件名与 website/src/release.ts 不符，未上传");
if ((await stat(installer)).size !== release.sizeBytes) throw new Error("安装包长度不符，未上传");
const hash = createHash("sha256");
for await (const chunk of createReadStream(installer)) hash.update(chunk);
if (hash.digest("hex") !== release.sha256) throw new Error("安装包 SHA-256 不符，未上传");

console.log(`校验通过，上传 ${release.filename} 到 cyword-downloads（Standard）。`);
const child = spawn(process.execPath, [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
  "r2", "object", "put", `cyword-downloads/${release.filename}`, "--file", installer,
  "--remote", "--storage-class", "Standard", "--content-type", "application/octet-stream",
  "--cache-control", "public, max-age=86400, immutable, no-transform"],
  { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
