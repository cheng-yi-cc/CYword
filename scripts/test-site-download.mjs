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
const run = promisify(execFile);
await mkdir(work, { recursive: true });
await writeFile(fixturePath, fixture);

// 测试数据只写入本地 R2 模拟器，绝不使用 --remote。
await run(process.execPath, [cli, "r2", "object", "put", `${bucket}/${fixtureName}`,
  "--local", "--persist-to", state, "--file", fixturePath], { cwd: root, windowsHide: true });

const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/downloads/${fixtureName}`;
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
    for (const name of ["CYword-Setup-99.99.99.exe", "secret.txt", "folder/CYword-Setup-0.0.0.exe"]) {
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
