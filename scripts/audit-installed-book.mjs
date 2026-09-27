import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { zipLayout, readZipEntry } from './zip-layout.mjs';
import { validWordDetail } from '../src/word-validation.ts';
import { bookImageUrls } from './book-images.mjs';
import { buildPlan } from '../src/progress.ts';

// Read the installed Windows archive/unpacked resources, or the signed APK itself.
const target = path.resolve(process.argv[2]);
const apk = target.endsWith('.apk');
let read, names;
if (apk) {
  const layout = await zipLayout(target);
  names = [...layout.entries.keys()].filter(n => n.startsWith('assets/public/')).map(n => n.slice(14));
  read = name => readZipEntry(target, layout.entries.get(`assets/public/${name}`));
} else {
  const require = createRequire(import.meta.url), asar = require('@electron/asar');
  const archive = path.join(target, 'app.asar'), { header, headerSize } = asar.getRawHeader(archive);
  const entries = new Map();
  function walk(node, prefix = '') { for (const [name, entry] of Object.entries(node.files ?? {})) {
    const full = prefix + name;
    if (entry.files) walk(entry, full + '/'); else entries.set(full, entry);
  } }
  walk(header);
  names = [...entries.keys()].filter(n => n.startsWith('dist/')).map(n => n.slice(5));
  read = async name => {
    const entry = entries.get('dist/' + name); assert.ok(entry, `Missing packaged ${name}`);
    if (entry.unpacked) return fs.readFile(path.join(archive + '.unpacked', 'dist', name));
    const file = await fs.open(archive, 'r');
    try {
      const bytes = Buffer.alloc(entry.size);
      const result = await file.read(bytes, 0, bytes.length, 8 + headerSize + Number(entry.offset));
      assert.equal(result.bytesRead, bytes.length); return bytes;
    } finally { await file.close(); }
  };
}
const json = async name => JSON.parse((await read(name)).toString('utf8'));
const catalog = await json('book/catalog.json'), manifest = await json('book/manifest.json');
const ids = Object.keys(catalog.words), plan = buildPlan(catalog);
assert.equal(ids.length, 5166); assert.equal(manifest.wordCount, ids.length);
assert.equal(catalog.dataVersion, manifest.dataVersion); assert.equal(plan.length, 40);
assert.equal(plan.filter(d => d.kind === 'review').length, 10);
const images = new Set(), audio = new Set();
for (const id of ids) {
  const word = await json(`book/words/${id}.json`);
  assert.ok(validWordDetail(word)); assert.equal(word.id, id); assert.equal(word.bookCode, catalog.book.code);
  audio.add(word.audioUrl); bookImageUrls(word, images);
  for (const bridge of word.meaningBridges ?? []) assert.ok(catalog.words[bridge.anchorId]);
}
for (const url of audio) assert.ok(manifest.audio[url]);
for (const url of images) assert.ok(manifest.images[url]);
const assets = [...new Map([...Object.values(manifest.audio), ...Object.values(manifest.images)].map(a => [a.file, a])).values()];
let assetBytes = 0;
for (const asset of assets) {
  assert.match(asset.file, /^(audio|images)\/[a-f0-9]+\.(mp3|wav|ogg|png|jpg|webp|gif)$/);
  const bytes = await read('book/' + asset.file);
  assert.equal(bytes.length, asset.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assetBytes += bytes.length;
}
const font = names.find(n => /^assets\/Gentium-Regular-.*\.woff2$/.test(n));
assert.ok(font); assert.ok((await read(font)).equals(await fs.readFile('src/assets/Gentium-Regular.woff2')));
const report = { target, date: new Date(), source: apk ? 'signed APK entries' : 'installed app.asar and unpacked resources',
  words: ids.length, planDays: plan.length, dataVersion: catalog.dataVersion, curriculumVersion: catalog.curriculumVersion,
  audioReferences: audio.size, imageReferences: images.size, assetFiles: assets.length, assetBytes, font, passed: true };
await fs.mkdir('.work/acceptance', { recursive: true });
await fs.writeFile(`.work/acceptance/${apk ? 'apk' : 'installed-windows'}-book-audit.json`, JSON.stringify(report, null, 2));
console.log(report);
