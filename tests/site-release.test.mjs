import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { blake2b } from "@noble/hashes/blake2.js";
import { verifyBlockmap } from "../scripts/verify-blockmap.mjs";
import { isReleasePointer, isPublicRelease, toPublicRelease } from "../website/server/release-manifest.ts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const blockmapFor = data => gzipSync(Buffer.from(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0,
  sizes: [data.length], checksums: [Buffer.from(blake2b(data, { dkLen: 18 })).toString("base64")] }] })));

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
      writeFile(path.join(fixtureRoot, `${filename}.blockmap`), blockmapFor(installer)),
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
    assert.equal(pointer.schemaVersion, 2);
    assert.equal(pointer.notesUrl, "/#release-notes");
    assert.equal(pointer.githubDownloadUrl, undefined);
    assert.equal(pointer.repositoryUrl, undefined);
    assert.equal(pointer.blockmapSha256, createHash("sha256").update(blockmapFor(installer)).digest("hex"));
    assert.equal(pointer.updaterMetadataSha256, createHash("sha256").update(manifest).digest("hex"));
    assert.equal(pointer.updaterMetadataSizeBytes, Buffer.byteLength(manifest));
    assert.ok(isReleasePointer(pointer));
    assert.ok(isPublicRelease(toPublicRelease(pointer)));
    assert.equal(pointer.assetPath, assetPath);
    assert.equal(pointer.updaterMetadataPath, `releases/${version}/${sha256}/latest.yml`);
    assert.equal(pointer.sha256, sha256);
    assert.match(manifest, new RegExp(`url: ${assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(manifest, new RegExp(`path: ${assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

const hash = "a".repeat(64);
const v2 = {
  schemaVersion: 2, version: "1.2.3", publishedAt: "2026-09-20T00:00:00.000Z",
  filename: "CYword-Setup-1.2.3.exe", sizeBytes: 2048, sha256: hash,
  assetPath: `releases/1.2.3/${hash}/CYword-Setup-1.2.3.exe`,
  blockmapPath: `releases/1.2.3/${hash}/CYword-Setup-1.2.3.exe.blockmap`,
  updaterMetadataPath: `releases/1.2.3/${hash}/latest.yml`,
  blockmapSha256: "b".repeat(64), blockmapSizeBytes: 256,
  updaterMetadataSha256: "c".repeat(64), updaterMetadataSizeBytes: 256,
  notesUrl: "/#release-notes",
};

test("release manifests normalize legacy private links and validate the full asset identity", () => {
  const legacy = { ...v2, schemaVersion: 1,
    githubDownloadUrl: "https://github.com/cheng-yi-cc/CYword/releases/download/v1.2.3/CYword-Setup-1.2.3.exe",
    notesUrl: "https://github.com/cheng-yi-cc/CYword/releases/tag/v1.2.3",
    repositoryUrl: "https://github.com/cheng-yi-cc/CYword",
  };
  assert.ok(isReleasePointer(legacy));
  const publicRelease = toPublicRelease(legacy);
  assert.equal(publicRelease.notesUrl, "/#release-notes");
  assert.equal(publicRelease.githubDownloadUrl, undefined);
  assert.equal(publicRelease.repositoryUrl, undefined);
  assert.ok(isReleasePointer(v2));
  for (const patch of [
    { schemaVersion: 3 }, { sha256: "d".repeat(64) }, { sizeBytes: 0 },
    { assetPath: "https://example.com/installer.exe" },
    { notesUrl: "https://example.com/notes" }, { blockmapSha256: undefined },
    { updaterMetadataSizeBytes: 0 }, { blockmapPath: v2.assetPath },
  ]) assert.equal(isReleasePointer({ ...v2, ...patch }), false, JSON.stringify(patch));
  assert.ok(isPublicRelease(publicRelease));
  assert.equal(isPublicRelease({ ...publicRelease, sha256: "d".repeat(64) }), false);
  assert.equal(isPublicRelease({ ...publicRelease, downloadPath: "//example.com/installer.exe" }), false);
});

test("release preparation rejects mismatched metadata, extra assets and empty blockmaps", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cyword-release-invalid-"));
  const version = packageJson.version;
  const filename = `CYword-Setup-${version}.exe`;
  const installer = Buffer.from("release validation fixture");
  const sha512 = createHash("sha512").update(installer).digest("base64");
  const valid = `version: ${version}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${filename}\nsha512: ${sha512}\n`;
  try {
    await writeFile(path.join(fixtureRoot, filename), installer);
    await writeFile(path.join(fixtureRoot, `${filename}.blockmap`), "blockmap");
    for (const malformed of [
      valid.replace(`\nsha512: ${sha512}`, "\nsha512: wrong"),
      valid.replace(`path: ${filename}`, "path: different.exe"),
      valid + "  - url: https://example.com/extra.exe\n",
      valid.replace(`size: ${installer.length}`, "size: 1"),
      valid + `version: 9.9.9\n`,
      valid + `files: [{url: "https://example.com/extra.exe"}]\n`,
    ]) {
      await writeFile(path.join(fixtureRoot, "latest.yml"), malformed);
      await assert.rejects(run(process.execPath, [path.join(root, "scripts/publish-site-release.mjs"), fixtureRoot, "--prepare-only"], { cwd: root, windowsHide: true }));
    }
    await writeFile(path.join(fixtureRoot, "latest.yml"), valid);
    await writeFile(path.join(fixtureRoot, `${filename}.blockmap`), "");
    await assert.rejects(run(process.execPath, [path.join(root, "scripts/publish-site-release.mjs"), fixtureRoot, "--prepare-only"], { cwd: root, windowsHide: true }));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Android release preparation produces an independent public manifest", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cyword-android-release-"));
  try {
    const { versionName: version } = JSON.parse(await readFile(path.join(root, "android/version.json"), "utf8"));
    const filename = `CYword-Android-${version}.apk`;
    const installer = Buffer.from("android fixture");
    const sha256 = createHash("sha256").update(installer).digest("hex");
    await writeFile(path.join(fixtureRoot, filename), installer);
    await run(process.execPath, [path.join(root, "scripts/publish-site-release.mjs"), fixtureRoot, "--android", "--prepare-only"], { cwd: root, windowsHide: true });
    const pointer = JSON.parse(await readFile(path.join(root, ".work", "site-release", `android-${version}-${sha256.slice(0, 16)}`, "current.json"), "utf8"));
    assert.equal(pointer.schemaVersion, 2);
    assert.equal(pointer.assetPath, `releases/android/${version}/${sha256}/${filename}`);
    assert.ok(isReleasePointer(pointer, true));
    assert.ok(isPublicRelease(toPublicRelease(pointer), true));
    assert.equal(isReleasePointer(pointer), false);
    assert.equal(pointer.updaterMetadataPath, undefined);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("blockmaps must match installer content, including when another installer has the same length", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cyword-blockmap-"));
  const installer = path.join(fixtureRoot, "installer.exe"), blockmap = `${installer}.blockmap`;
  try {
    const bytes = Buffer.from("actual installer fixture");
    await writeFile(installer, bytes);
    await writeFile(blockmap, blockmapFor(bytes));
    await verifyBlockmap(installer, blockmap);
    await writeFile(installer, Buffer.alloc(bytes.length, 42));
    await assert.rejects(verifyBlockmap(installer, blockmap), /与安装器不一致/);
    await writeFile(blockmap, "not a gzip blockmap");
    await assert.rejects(verifyBlockmap(installer, blockmap), /gzip/);
  } finally { await rm(fixtureRoot, { recursive: true, force: true }); }
});
