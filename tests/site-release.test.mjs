import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

test("site release preparation validates and rewrites updater assets", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cyword-site-release-"));
  try {
    const version = packageJson.version;
    const filename = `CYword-Setup-${version}.exe`;
    const installer = Buffer.alloc(32 * 1024);
    for (let index = 0; index < installer.length; index++) installer[index] = index % 251;
    const sha256 = createHash("sha256").update(installer).digest("hex");
    const sha512 = createHash("sha512").update(installer).digest("base64");
    const assetPath = `releases/${version}/${sha256}/${filename}`;
    await mkdir(fixtureRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(fixtureRoot, filename), installer),
      writeFile(path.join(fixtureRoot, `${filename}.blockmap`), "blockmap fixture\n"),
      writeFile(path.join(fixtureRoot, "latest.yml"), [
        `version: ${version}`,
        "files:",
        `  - url: ${filename}`,
        `    sha512: ${sha512}`,
        `    size: ${installer.length}`,
        `path: ${filename}`,
        `sha512: ${sha512}`,
        "releaseDate: '2026-09-01T00:00:00.000Z'",
        "",
      ].join("\n")),
    ]);

    const result = await run(process.execPath, [
      path.join(root, "scripts", "publish-site-release.mjs"),
      fixtureRoot,
      "--prepare-only",
    ], { cwd: root, windowsHide: true });
    assert.match(result.stdout, /仅生成发布文件，未上传/);

    const staged = path.join(root, ".work", "site-release", `${version}-${sha256.slice(0, 16)}`);
    const pointer = JSON.parse(await readFile(path.join(staged, "current.json"), "utf8"));
    const manifest = await readFile(path.join(staged, "latest.yml"), "utf8");
    assert.equal(pointer.assetPath, assetPath);
    assert.equal(pointer.updaterMetadataPath, `releases/${version}/${sha256}/latest.yml`);
    assert.equal(pointer.sha256, sha256);
    assert.match(manifest, new RegExp(`url: ${assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(manifest, new RegExp(`path: ${assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
