import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assertReleaseSchemaSupport } from "../scripts/release-preflight.mjs";

test("publishing preflight checks a fixed production origin and refuses redirects", async () => {
  for (const android of [false, true]) {
    let calls = 0;
    await assertReleaseSchemaSupport(android, async (url, options) => {
      calls++;
      assert.equal(url, `https://cyword.chengyi.me/downloads/${android ? "android/" : ""}latest.json`);
      assert.equal(options.method, "HEAD");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal);
      return new Response(null, { status: 404, headers: { "X-CYword-Release-Schemas": "1, 2" } });
    });
    assert.equal(calls, 1);
  }
});

test("old or unreachable download functions block publishing with a deployment instruction", async () => {
  for (const header of [null, "1", "12", "v2"]) {
    await assert.rejects(assertReleaseSchemaSupport(false, async () => new Response(null, {
      headers: header === null ? {} : { "X-CYword-Release-Schemas": header },
    })), /先部署官网函数/);
  }
  await assert.rejects(assertReleaseSchemaSupport(false, async () => { throw new Error("redirect refused"); }), /未写入 R2.*先部署官网函数/);
});

test("download functions advertise schema support even without a usable release pointer", async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../website/functions/downloads/[[path]].ts", import.meta.url))], bundle: true, write: false, platform: "browser", format: "esm" });
  const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  for (const method of ["GET", "HEAD"]) {
    for (const android of [false, true]) {
      const response = await onRequest({
        request: new Request(`https://example.test/downloads/${android ? "android/" : ""}latest.json`, { method }),
        env: { DOWNLOADS: { get: async () => null } },
      });
      assert.equal(response.status, android ? 404 : 200);
      assert.equal(response.headers.get("X-CYword-Release-Schemas"), "1,2");
    }
  }
});
