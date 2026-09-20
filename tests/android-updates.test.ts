import test from "node:test";
import assert from "node:assert/strict";
import { AndroidUpdateService, isNewerVersion } from "../src/android-updates.ts";

const release = (version = "0.1.3") => ({ version, publishedAt: "2026-09-20T10:00:00Z", filename: `CYword-Android-${version}.apk`, sizeBytes: 1000, sha256: "a".repeat(64), downloadPath: `/downloads/releases/android/${version}/${"a".repeat(64)}/CYword-Android-${version}.apk`, notesUrl: "/#release-notes" });

test("Android compares numeric versions and never offers same/older versions", async () => {
  assert.equal(isNewerVersion("0.1.10", "0.1.9"), true);
  assert.equal(isNewerVersion("0.2.0", "0.1.99"), true);
  assert.throws(() => isNewerVersion("0.1.2-beta", "0.1.1"));
  for (const version of ["0.1.1", "0.1.2", "0.1.3"]) {
    const service = new AndroidUpdateService({ version: async () => "0.1.2", release: async () => release(version), open: async () => {} });
    await service.check();
    assert.equal(service.getSnapshot().status, version === "0.1.3" ? "available" : "current");
  }
});

test("Android rejects malformed, foreign and Windows download manifests", async () => {
  for (const value of [null, {...release(), downloadPath: "https://attacker.test/app.apk"}, {...release(), filename: "CYword-Setup-0.1.3.exe"}, {...release(), sha256: "bad"}, {...release(), downloadPath: "/downloads/android/latest"}]) {
    let opens=0;
    const service = new AndroidUpdateService({ version: async () => "0.1.2", release: async () => value, open: async () => { opens++; } });
    await service.check(); await service.download();
    assert.equal(service.getSnapshot().status, "error"); assert.equal(opens, 0);
  }
});

test("Android deduplicates checks, throttles resumes and permits immediate manual retry", async () => {
  let calls=0, now=0, unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock=resolve; });
  const service = new AndroidUpdateService({ version: async () => "0.1.2", release: async () => { calls++; await gate; return release(); }, open: async () => {}, now: () => now });
  const first=service.check(true); assert.equal(service.check(), first);
  unblock(); await first; assert.equal(calls,1);
  await service.check(true); assert.equal(calls,1);
  await service.check(); assert.equal(calls,2);
  now=6*60*60*1000; await service.check(true); assert.equal(calls,3);
});

test("Android download stays user initiated, uses checked immutable URL and retries browser errors", async () => {
  const urls:string[]=[]; let fail=true;
  const service = new AndroidUpdateService({ version: async () => "0.1.2", release: async () => release(), open: async url => { urls.push(url); if(fail) throw Error("no browser"); } });
  await service.check(true); assert.equal(urls.length,0);
  const first=service.download(); assert.equal(service.download(),first); await first;
  assert.equal(service.getSnapshot().status,"available"); assert.match(service.getSnapshot().message!, /无法打开/);
  fail=false; await service.download();
  assert.equal(urls.length,2); assert.equal(urls[1],"https://cyword.chengyi.me"+release().downloadPath);
  assert.match(service.getSnapshot().message!, /已打开浏览器/);
});

test("Android offline check is retryable and preserves a previously validated update", async () => {
  let fail=true;
  const service = new AndroidUpdateService({ version: async () => "0.1.2", release: async () => { if(fail) throw Error("offline"); return release(); }, open: async () => {} });
  await service.check(); assert.equal(service.getSnapshot().status,"error");
  fail=false; await service.check(); assert.equal(service.getSnapshot().status,"available");
  fail=true; await service.check(); assert.equal(service.getSnapshot().status,"available"); assert.equal(service.getSnapshot().release?.version,"0.1.3");
});
