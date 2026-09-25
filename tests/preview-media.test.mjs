import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipFixture } from "./zip-fixture.mjs";
import { previewMedia } from "../scripts/preview-media.mjs";

test("preview reads only requested archive media, verifies hashes and refuses unknown paths", async () => {
  await mkdir(".work/preview-tests", { recursive: true });
  const root = await mkdtemp(path.resolve(".work/preview-tests/run-"));
  await mkdir(path.join(root, "release"));
  const bytes = Buffer.from("local audio bytes"), url = "https://cdn.aimwords.com/audio/ab.mp3";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = { audio: { [url]: { file: "audio/ab.mp3", bytes: bytes.length, sha256 } }, images: {} };
  const apk = path.join(root, "release/CYword-Android-1.0.0.apk");
  await writeFile(apk, zipFixture([["assets/public/book/manifest.json", Buffer.from(JSON.stringify(manifest))], ["assets/public/book/audio/ab.mp3", bytes]]));
  const media = previewMedia(root);
  for (let i = 0; i < 2; i++) assert.deepEqual(await media(url), { bytes, extension: "mp3" });
  await assert.rejects(media("../../package.json"), /缺少此资源/);
  const corrupt = Buffer.from(bytes); corrupt[0] ^= 255;
  await writeFile(apk, zipFixture([["assets/public/book/manifest.json", Buffer.from(JSON.stringify(manifest))], ["assets/public/book/audio/ab.mp3", corrupt]]));
  await assert.rejects(previewMedia(root)(url), /checksum mismatch/);
});
