import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const output = path.resolve(".work/bundled-book"), cache = path.resolve(".work/book-images-webp");
const manifestPath = path.join(output, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originals = [...new Map(Object.values(manifest.images).map(asset => [asset.file, asset])).values()];
const replacements = new Map();
await fs.mkdir(cache, { recursive: true });
sharp.concurrency(1);
let cursor = 0, completed = 0, failure;
console.log(`Losslessly optimizing ${originals.length} unique book images…`);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < originals.length && !failure) {
    const asset = originals[cursor++];
    try {
      if (!/^images\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset.file)) throw Error("Invalid image path");
      if (asset.file.endsWith(".png")) {
        const original = await fs.readFile(path.join(output, asset.file));
        if (hash(original) !== asset.sha256) throw Error("Original image hash mismatch");
        const cached = path.join(cache, `${asset.sha256}.webp`);
        let encoded;
        try {
          const bytes = await fs.readFile(cached), checksum = await fs.readFile(`${cached}.sha256`, "utf8");
          if (hash(bytes) === checksum) encoded = bytes;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!encoded) {
          encoded = await sharp(original).keepMetadata().webp({ lossless: true, effort: 0 }).toBuffer();
          // Compare all decoded RGBA pixels; any color/alpha mismatch keeps the original.
          const [before, after] = await Promise.all([
            sharp(original).ensureAlpha().raw().toBuffer(), sharp(encoded).ensureAlpha().raw().toBuffer(),
          ]);
          if (!before.equals(after)) encoded = original;
          if (encoded !== original) {
            await fs.writeFile(cached, encoded);
            await fs.writeFile(`${cached}.sha256`, hash(encoded));
          }
        }
        if (encoded.length < original.length) {
          const checksum = hash(encoded), file = `images/${checksum}.webp`;
          await fs.writeFile(path.join(output, file), encoded);
          replacements.set(asset.file, { file, bytes: encoded.length, sha256: checksum, originalSha256: asset.sha256 });
        }
      }
      completed++;
      if (completed % 200 === 0 || completed === originals.length) console.log(`Optimized ${completed}/${originals.length}`);
    } catch (error) { failure ??= error; }
  }
}));
if (failure) throw failure;
for (const [url, asset] of Object.entries(manifest.images)) manifest.images[url] = replacements.get(asset.file) ?? asset;
await fs.writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest));
await fs.rename(`${manifestPath}.tmp`, manifestPath);
const used = new Set(Object.values(manifest.images).map(asset => asset.file));
for (const asset of originals) {
  if (used.has(asset.file)) continue;
  const target = path.resolve(output, asset.file);
  if (path.dirname(target) !== path.join(output, "images")) throw Error("Invalid generated image cleanup path");
  await fs.unlink(target);
}
const bytes = new Map(Object.values(manifest.images).map(asset => [asset.file, asset.bytes]));
console.log(`Installed images: ${(originals.reduce((n, asset) => n + asset.bytes, 0) / 1e6).toFixed(1)} MB → ${([...bytes.values()].reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB; pixel-identical PNG optimization.`);
