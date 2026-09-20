import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = path.join(root, ".work", "download-tests");
const state = path.join(work, "state");
const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = JSON.parse(await readFile(path.join(root, "website", "wrangler.jsonc"), "utf8"));
const bucket = config.r2_buckets.find(({ binding }) => binding === "DOWNLOADS").bucket_name;
const fixtureName = "CYword-Setup-0.0.0.exe";
const fixturePath = path.join(work, fixtureName);
const fixture = Buffer.alloc(256 * 1024);
for (let i = 0; i < fixture.length; i++) fixture[i] = i % 251;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixtureDigest = digest(fixture);
const baseKey = `releases/0.0.0/${fixtureDigest}`;
const assetKey = `${baseKey}/${fixtureName}`;
const blockmapKey = `${assetKey}.blockmap`;
const updaterKey = `${baseKey}/latest.yml`;
const blockmap = Buffer.from("deterministic blockmap fixture\n");
const updaterMetadata = `version: 0.0.0\nfiles:\n  - url: ${assetKey}\n    sha512: fixture\n    size: ${fixture.length}\nreleaseDate: '2026-09-01T00:00:00.000Z'\n`;
const pointer = {
  schemaVersion: 1,
  version: "0.0.0",
  publishedAt: "2026-09-01T00:00:00.000Z",
  filename: fixtureName,
  sizeBytes: fixture.length,
  sha256: fixtureDigest,
  assetPath: assetKey,
  blockmapPath: blockmapKey,
  updaterMetadataPath: updaterKey,
  githubDownloadUrl: `https://github.com/cheng-yi-cc/CYword/releases/download/v0.0.0/${fixtureName}`,
  notesUrl: "https://github.com/cheng-yi-cc/CYword/releases/tag/v0.0.0",
  repositoryUrl: "https://github.com/cheng-yi-cc/CYword",
};
const run = promisify(execFile);
await mkdir(work, { recursive: true });
await writeFile(fixturePath, fixture);
const blockmapPath = path.join(work, `${fixtureName}.blockmap`);
const updaterPath = path.join(work, "latest.yml");
const pointerPath = path.join(work, "current.json");
await Promise.all([
  writeFile(blockmapPath, blockmap),
  writeFile(updaterPath, updaterMetadata),
  writeFile(pointerPath, `${JSON.stringify(pointer)}\n`),
]);

// 测试数据只写入本地 R2 模拟器，绝不使用 --remote。
const put = (key, file) => run(process.execPath, [cli, "r2", "object", "put", `${bucket}/${key}`,
  "--local", "--persist-to", state, "--file", file], { cwd: root, windowsHide: true });
// 多个 Wrangler 进程不能并发写同一个本地状态目录。
await put(fixtureName, fixturePath);
await put(assetKey, fixturePath);
await put(blockmapKey, blockmapPath);
await put(updaterKey, updaterPath);
await put("releases/current.json", pointerPath);
const androidName = "CYword-Android-0.1.0.apk";
const androidKey = `releases/android/0.1.0/${fixtureDigest}/${androidName}`;
const androidPointer = {
  schemaVersion: 2, version: "0.1.0", publishedAt: pointer.publishedAt,
  filename: androidName, sizeBytes: fixture.length, sha256: fixtureDigest, assetPath: androidKey,
  notesUrl: "/#release-notes",
};
const androidPointerPath = path.join(work, "android-current.json");
await writeFile(androidPointerPath, JSON.stringify(androidPointer));
await put(androidKey, fixturePath);
await put("releases/android/current.json", androidPointerPath);

const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/downloads/${assetKey}`;
const server = spawn(process.execPath, [cli, "pages", "dev", "--cwd", path.join(root, "website"),
  // Wrangler 4.127.1 本地 Pages 未自动注入此绑定，显式读取同一配置传给模拟器。
  "--r2", `DOWNLOADS=${bucket}`,
  "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", state,
  "--log-level", "error", "--show-interactive-dev-session=false"],
  { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", (chunk) => { logs += chunk; });
server.stderr.on("data", (chunk) => { logs += chunk; });
const request = (headers = {}, method = "GET", target = url) =>
  fetch(target, { method, headers, signal: AbortSignal.timeout(10000) });
const bytes = async (response) => Buffer.from(await response.arrayBuffer());
let passed = 0;
const check = async (name, operation) => {
  await operation();
  console.log(`PASS ${name}`);
  passed++;
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local server exited: ${logs}`);
    try {
      if ((await request({}, "HEAD", `${origin}/`)).status === 200) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Local download server did not start: ${logs}`);
  await check("Android pointer and redirect are independent of Windows", async () => {
    const latest = await request({}, "GET", `${origin}/downloads/android/latest.json`);
    assert.equal(latest.status, 200);
    assert.equal(latest.headers.get("X-CYword-Release-Schemas"), "1,2");
    const payload = await latest.json();
    assert.equal(payload.downloadPath, `/downloads/${androidKey}`);
    assert.equal(payload.notesUrl, "/#release-notes");
    assert.equal(payload.githubDownloadUrl, undefined);
    assert.equal(payload.repositoryUrl, undefined);
    const redirect = await fetch(`${origin}/downloads/android/latest`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), `${origin}/downloads/${androidKey}`);
    const windows = await request({}, "GET", `${origin}/downloads/latest.json`);
    assert.equal((await windows.json()).version, "0.0.0");
  });
  await check("APK streams with Android MIME, attachment and range support", async () => {
    const apk = await request({ Range: "bytes=0-31" }, "GET", `${origin}/downloads/${androidKey}`);
    assert.equal(apk.status, 206);
    assert.equal(apk.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.equal(apk.headers.get("content-disposition"), `attachment; filename="${androidName}"`);
    assert.deepEqual(await bytes(apk), fixture.subarray(0, 32));
  });
  await check("Android rejects mismatched versions and private pointer paths", async () => {
    for (const target of [androidKey.replace(androidName, "CYword-Android-9.9.9.apk"), "releases/android/current.json"]) {
      assert.equal((await request({}, "GET", `${origin}/downloads/${target}`)).status, 404);
    }
  });
  const head = await request({}, "HEAD");
  const etag = head.headers.get("etag");
  const modified = head.headers.get("last-modified");

  await check("HEAD returns metadata without a body", async () => {
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(fixture.length));
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal(head.headers.get("content-type"), "application/octet-stream");
    assert.equal(head.headers.get("content-disposition"), `attachment; filename="${fixtureName}"`);
    assert.ok(etag);
    assert.equal((await bytes(head)).length, 0);
  });
  await check("full download preserves every byte", async () => {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(digest(await bytes(response)), digest(fixture));
  });
  await check("latest release JSON and redirect use the same atomic pointer", async () => {
    const latest = await request({}, "GET", `${origin}/downloads/latest.json`);
    assert.equal(latest.status, 200);
    assert.equal(latest.headers.get("X-CYword-Release-Schemas"), "1,2");
    const capability = await request({}, "HEAD", `${origin}/downloads/latest.json`);
    assert.equal(capability.headers.get("X-CYword-Release-Schemas"), "1,2");
    assert.equal(latest.headers.get("cache-control"), "no-store");
    assert.deepEqual(await latest.json(), {
      version: pointer.version,
      publishedAt: pointer.publishedAt,
      filename: pointer.filename,
      sizeBytes: pointer.sizeBytes,
      sha256: pointer.sha256,
      downloadPath: `/downloads/${assetKey}`,
      notesUrl: "/#release-notes",
    });
    const redirect = await fetch(`${origin}/downloads/latest`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), `${origin}/downloads/${assetKey}`);
    assert.equal(redirect.headers.get("cache-control"), "no-store");
  });
  await check("electron-updater receives the versioned manifest through latest.yml", async () => {
    const response = await request({}, "GET", `${origin}/downloads/latest.yml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/x-yaml/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), updaterMetadata);
  });
  await check("blockmap is available from the content-addressed release path", async () => {
    const response = await request({}, "GET", `${origin}/downloads/${blockmapKey}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.deepEqual(await bytes(response), blockmap);
  });
  await check("legacy versioned installer URLs remain available during migration", async () => {
    const response = await request({}, "GET", `${origin}/downloads/${fixtureName}`);
    assert.equal(response.status, 200);
    assert.equal(digest(await bytes(response)), fixtureDigest);
  });
  for (const [range, start, end] of [["bytes=0-1023", 0, 1024], ["bytes=260000-", 260000, fixture.length],
    ["bytes=-100", fixture.length - 100, fixture.length], ["bytes=262140-999999", 262140, fixture.length]]) {
    await check(`resume ${range}`, async () => {
      const response = await request({ Range: range });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end - 1}/${fixture.length}`);
      assert.equal(response.headers.get("content-length"), String(end - start));
      assert.deepEqual(await bytes(response), fixture.subarray(start, end));
    });
  }
  await check("two range downloads reconstruct the original", async () => {
    const first = await bytes(await request({ Range: "bytes=0-100000" }));
    const last = await bytes(await request({ Range: "bytes=100001-", "If-Range": etag }));
    assert.equal(digest(Buffer.concat([first, last])), digest(fixture));
  });
  await check("invalid ranges cannot read outside the file", async () => {
    for (const range of [`bytes=${fixture.length}-`, "bytes=10-5", "bytes=-0"]) {
      const response = await request({ Range: range });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), `bytes */${fixture.length}`);
      await response.arrayBuffer();
    }
  });
  await check("unsupported multipart Range falls back to a full response", async () => {
    const response = await request({ Range: "bytes=0-9,20-29" });
    assert.equal(response.status, 200);
    assert.equal(digest(await bytes(response)), digest(fixture));
  });
  await check("HEAD ignores Range", async () => {
    const response = await request({ Range: "bytes=0-9" }, "HEAD");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(fixture.length));
  });
  await check("stale If-Range returns the full file", async () => {
    const response = await request({ Range: "bytes=0-9", "If-Range": '"old-file"' });
    assert.equal(response.status, 200);
    assert.equal(digest(await bytes(response)), digest(fixture));
  });
  await check("ETag and modification-date validators avoid redundant downloads", async () => {
    assert.equal((await request({ "If-None-Match": `W/${etag}` })).status, 304);
    assert.equal((await request({ "If-Modified-Since": modified })).status, 304);
    const stale = await request({ "If-Match": '"old-file"' });
    assert.equal(stale.status, 412);
    await stale.arrayBuffer();
  });
  await check("missing files and arbitrary paths return 404", async () => {
    for (const name of ["CYword-Setup-99.99.99.exe", "secret.txt", "folder/CYword-Setup-0.0.0.exe",
      `releases/0.0.0/${"0".repeat(64)}/${fixtureName}`, `${updaterKey}/extra`]) {
      const response = await request({}, "GET", `${origin}/downloads/${name}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.arrayBuffer();
    }
  });
  await check("write methods are rejected", async () => {
    const response = await request({}, "POST");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    await response.arrayBuffer();
  });
  await check("homepage remains a static page", async () => {
    const response = await request({}, "GET", `${origin}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /CYword/);
  });
  console.log(`${passed} download integration checks passed (local R2 only).`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (process.platform === "win32" && server.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else if (server.exitCode === null) server.kill("SIGTERM");
}
