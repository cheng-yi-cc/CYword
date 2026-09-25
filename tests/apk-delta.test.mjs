import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { zipFixture } from "./zip-fixture.mjs";
import { apkBlockmap } from "../scripts/apk-blockmap.mjs";
const run = promisify(execFile);

test("native APK reconstruction reuses ZIP data, resumes verified chunks and rejects corrupt/rangeless responses", async () => {
  await mkdir(".work/apk-delta-tests", { recursive: true });
  const work = await mkdtemp(path.resolve(".work/apk-delta-tests/run-"));
  const localJdk = "D:/tools/cyword-android/jdk-21.0.12.1+1";
  const jdk = process.env.CYWORD_JAVA_HOME || process.env.JAVA_HOME || (await access(localJdk).then(() => localJdk, () => ""));
  const java = name => jdk ? path.join(jdk, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
  await run(java("javac"), ["-encoding", "UTF-8", "-d", work, "android/app/src/main/java/me/chengyi/cyword/ApkDelta.java", "android/app/src/main/java/me/chengyi/cyword/UpdateTransport.java", "tests/ApkDeltaHarness.java"], { windowsHide: true });
  const media = randomBytes(6 * 1024 * 1024), changed = randomBytes(2 * 1024 * 1024);
  const old = zipFixture([["book/audio", media], ["old", Buffer.from("old UI")]]);
  const next = zipFixture([["new-ui", changed], ["book/renamed", media], ["tail", randomBytes(8192)]]);
  const oldFile = path.join(work, "old.apk"), newFile = path.join(work, "new.apk");
  await writeFile(oldFile, old); await writeFile(newFile, next);
  const { manifest } = await apkBlockmap(newFile);
  const plan = path.join(work, "plan.txt");
  await writeFile(plan, `${manifest.size} ${manifest.sha256}\n` + manifest.blocks.map(b => `${b.size} ${b.sha256}${b.data ? ` ${b.data}` : ""}`).join("\n"));
  let mode = "ok", sent = 0, requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "");
    assert.ok(match);
    const start = Number(match[1]), end = Number(match[2]);
    if (mode === "range") { res.writeHead(200); res.end("refused"); return; }
    if (mode === "interrupt" && requests > 1) { res.writeHead(503); res.end(); return; }
    const bytes = Buffer.from(next.subarray(start, end + 1));
    if (mode === "corrupt") bytes[0] ^= 255;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${next.length}`, "Content-Length": bytes.length });
    sent += bytes.length; res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/new.apk`;
  const rebuild = target => run(java("java"), ["-cp", work, "ApkDeltaHarness", oldFile, path.join(work, target), plan, url], { windowsHide: true });
  try {
    for (const failure of ["range", "corrupt", "interrupt"]) {
      mode = failure; sent = 0; requests = 0;
      await assert.rejects(rebuild(`${failure}.apk`));
    }
    const firstDownload = sent;
    mode = "ok"; sent = 0; requests = 0;
    await rebuild("interrupt.apk");
    assert.ok(sent < changed.length / 10, `resume downloaded ${sent}`);
    assert.deepEqual(await readFile(path.join(work, "interrupt.apk")), next);
    sent = 0; await rebuild("fresh.apk");
    assert.ok(sent < next.length / 3, `delta downloaded ${sent}/${next.length}`);
    assert.deepEqual(await readFile(path.join(work, "fresh.apk")), next);
    console.log(`Android fixture: ${sent}/${next.length} network bytes; interrupted first pass ${firstDownload}, resumed only missing bytes`);
    sent = 0; await rebuild("fresh.apk"); assert.equal(sent, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
