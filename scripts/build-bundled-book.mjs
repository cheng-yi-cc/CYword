import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { bookImageUrls, imageExtension } from "./book-images.mjs";

const root = process.cwd();
const dataDir = path.join(root, "data");
const output = path.join(root, ".work/bundled-book");
const cache = path.join(root, ".work/book-audio");
const imageCache = path.join(root, ".work/book-images");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(await fs.readFile(path.join(dataDir, "catalog.json"), "utf8"));
delete catalog.generatedAt;
const hash = createHash("sha256").update("cyword-installed-book-v1\0").update(JSON.stringify(catalog));
const ids = Object.keys(catalog.words).sort();
if (!ids.length || ids.length !== catalog.stats.wordCount) throw Error("Incomplete compiled catalog");
// Only generated files in this exact workspace directory are replaced.
if (path.dirname(output) !== path.join(root, ".work")) throw Error("Invalid bundle directory");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "words"), { recursive: true });
await fs.mkdir(path.join(output, "audio"), { recursive: true });
await fs.mkdir(path.join(output, "images"), { recursive: true });
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(imageCache, { recursive: true });
const urls = new Set();
const imageUrls = new Set();
for (let offset = 0; offset < ids.length; offset += 64) {
  const entries = await Promise.all(ids.slice(offset, offset + 64).map(async id => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error("Invalid word ID");
    const raw = await fs.readFile(path.join(dataDir, "words", `${id}.json`));
    const word = JSON.parse(raw);
    bookImageUrls(word, imageUrls);
    if (word.id !== id || word.bookCode !== catalog.book.code) throw Error(`Invalid word: ${id}`);
    const url = new URL(word.audioUrl);
    if (url.origin !== "https://cdn.aimwords.com" || !/^\/audio\/[a-f0-9]+\.(mp3|wav)$/i.test(url.pathname) || url.search || url.hash || url.username || url.password) throw Error(`Invalid audio: ${id}`);
    urls.add(url.href);
    return { id, raw };
  }));
  // Hash in sorted ID order even though file I/O runs concurrently.
  for (const { id, raw } of entries) hash.update(id).update(raw);
  await Promise.all(entries.map(({ id, raw }) => fs.writeFile(path.join(output, "words", `${id}.json`), raw)));
}
catalog.dataVersion = hash.digest("hex").slice(0, 16);
function audioExtension(bytes) {
  if (!bytes.length || bytes.length > 5_000_000) return false;
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "wav";
  // The original CDN serves some Vorbis recordings under .mp3 URLs.
  if (bytes.toString("ascii", 0, 4) === "OggS" && bytes.includes(Buffer.from("vorbis"))) return "ogg";
  if (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  return false;
}
const audio = {}, pending = [...urls].sort();
let cursor = 0, completed = 0, failure;
console.log(`Preparing ${ids.length} installed words and ${pending.length} audio files…`);
await Promise.all(Array.from({ length: 12 }, async () => {
  while (cursor < pending.length && !failure) {
    const url = pending[cursor++], file = new URL(url).pathname.slice(1), cached = path.join(cache, path.basename(file));
    try {
      let bytes;
      try {
        const saved = await fs.readFile(cached);
        const checksum = await fs.readFile(`${cached}.sha256`, "utf8");
        if (audioExtension(saved) && sha256(saved) === checksum) bytes = saved;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (let attempt = 0; !bytes && attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          const downloaded = Buffer.from(await response.arrayBuffer());
          if (!audioExtension(downloaded)) throw Error("Invalid audio payload");
          bytes = downloaded;
          await fs.writeFile(cached, bytes);
          await fs.writeFile(`${cached}.sha256`, sha256(bytes));
        } catch (error) { if (attempt === 2) throw error; }
      }
      const installedFile = file.replace(/\.[^.]+$/, `.${audioExtension(bytes)}`);
      await fs.writeFile(path.join(output, installedFile), bytes);
      audio[url] = { file: installedFile, bytes: bytes.length, sha256: sha256(bytes) };
      completed++;
      if (completed % 500 === 0 || completed === pending.length) console.log(`Installed audio ${completed}/${pending.length}`);
    } catch (error) { failure ??= new Error(`Could not bundle ${url}`, { cause: error }); }
  }
}));
if (failure) throw failure;
const images = {}, pendingImages = [...imageUrls].sort();
cursor = 0; completed = 0;
console.log(`Preparing ${pendingImages.length} original book images…`);
await Promise.all(Array.from({ length: 12 }, async () => {
  while (cursor < pendingImages.length && !failure) {
    const url = pendingImages[cursor++], cached = path.join(imageCache, sha256(url));
    try {
      let bytes;
      try {
        const saved = await fs.readFile(cached), checksum = await fs.readFile(`${cached}.sha256`, "utf8");
        if (imageExtension(saved) && sha256(saved) === checksum) bytes = saved;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!bytes) {
        for (let attempt = 0; !bytes && attempt < 3; attempt++) {
          try {
            const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            const downloaded = Buffer.from(await response.arrayBuffer());
            if (!imageExtension(downloaded)) throw Error("Invalid image payload");
            bytes = downloaded;
          } catch (error) { if (attempt === 2) throw error; }
        }
        await fs.writeFile(cached, bytes);
        await fs.writeFile(`${cached}.sha256`, sha256(bytes));
      }
      // Identical pictures referenced by several roots share one installed file.
      const checksum = sha256(bytes), file = `images/${checksum}.${imageExtension(bytes)}`;
      await fs.writeFile(path.join(output, file), bytes);
      images[url] = { file, bytes: bytes.length, sha256: checksum };
      completed++;
      if (completed % 200 === 0 || completed === pendingImages.length) console.log(`Installed images ${completed}/${pendingImages.length}`);
    } catch (error) { failure ??= new Error(`Could not bundle image ${url}`, { cause: error }); }
  }
}));
if (failure) throw failure;
await fs.writeFile(path.join(output, "catalog.json"), JSON.stringify(catalog));
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, bookCode: catalog.book.code, dataVersion: catalog.dataVersion, wordCount: ids.length, audio: Object.fromEntries(Object.entries(audio).sort(([a], [b]) => a.localeCompare(b))), images: Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b))) }));
console.log(`Complete installed book ${catalog.book.code}@${catalog.dataVersion}; audio ${(Object.values(audio).reduce((n, item) => n + item.bytes, 0) / 1e6).toFixed(1)} MB.`);
