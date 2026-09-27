import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validWordDetail } from "../src/word-validation.ts";
import { bookImageUrls } from "./book-images.mjs";
import { buildPlan } from "../src/progress.ts";

const directory = path.resolve(process.argv[2] || "dist/book");
const catalog = JSON.parse(await fs.readFile(path.join(directory, "catalog.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
const ids = Object.keys(catalog.words), plan = buildPlan(catalog);
if (ids.length !== 5166 || manifest.wordCount !== ids.length || manifest.dataVersion !== catalog.dataVersion
  || plan.length !== 40 || plan.filter(day => day.kind === "review").length !== 10) throw Error("Built book/curriculum is incomplete");
const images = new Set(), audio = new Set();
for (let i = 0; i < ids.length; i += 64) {
  for (const word of await Promise.all(ids.slice(i, i + 64).map(async id => {
    const value = JSON.parse(await fs.readFile(path.join(directory, "words", `${id}.json`), "utf8"));
    if (!validWordDetail(value) || value.id !== id || value.bookCode !== catalog.book.code) throw Error(`Invalid built word ${id}`);
    return value;
  }))) {
    audio.add(word.audioUrl); bookImageUrls(word, images);
    for (const bridge of word.meaningBridges ?? []) if (!catalog.words[bridge.anchorId]) throw Error(`Invalid built bridge ${word.id}`);
  }
}
for (const url of audio) if (!manifest.audio[url]) throw Error("Built audio reference is missing");
for (const url of images) if (!manifest.images[url]) throw Error("Built image reference is missing");
const assets = [...new Map([...Object.values(manifest.audio), ...Object.values(manifest.images)].map(asset => [asset.file, asset])).values()];
let assetBytes = 0;
for (let i = 0; i < assets.length; i += 16) {
  await Promise.all(assets.slice(i, i + 16).map(async asset => {
    if (!/^(audio|images)\/[a-f0-9]+\.(mp3|wav|ogg|png|jpg|webp|gif)$/.test(asset.file)) throw Error("Unsafe built asset path");
    const bytes = await fs.readFile(path.join(directory, asset.file));
    if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw Error(`Built asset checksum mismatch: ${asset.file}`);
    assetBytes += bytes.length;
  }));
}
const root = path.dirname(directory), files = await fs.readdir(path.join(root, "assets"));
const font = files.find(name => /^Gentium-Regular-.*\.woff2$/.test(name));
if (!font || !(await fs.readFile(path.join(root, "assets", font))).equals(await fs.readFile("src/assets/Gentium-Regular.woff2"))) throw Error("Built phonetic font is missing or changed");
const report = { directory, dataVersion: catalog.dataVersion, curriculumVersion: catalog.curriculumVersion, words: ids.length, planDays: plan.length,
  audioReferences: audio.size, imageReferences: images.size, verifiedAssetFiles: assets.length, assetBytes, font, method: "All built JSON structures/references and SHA-256 media verified; this does not claim listening to every audio file." };
await fs.mkdir(".work/preflight", { recursive: true });
await fs.writeFile(".work/preflight/bundled-book-audit.json", JSON.stringify(report, null, 2));
console.log(report);
