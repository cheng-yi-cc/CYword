import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const apiSchemaVersion = 2;
const bookCode = process.env.CYWORD_BOOK ?? process.argv[2] ?? "cet6";
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(bookCode)) {
  throw new Error(`Invalid book code: ${bookCode}`);
}

const dataDir = path.join(projectRoot, "data");
const wordDir = path.join(dataDir, "words");
const outputRoot = path.join(projectRoot, ".work", "book-api", bookCode);
const catalogSource = JSON.parse(fs.readFileSync(path.join(dataDir, "catalog.json"), "utf8"));
const wordNames = fs.readdirSync(wordDir).filter((name) => name.endsWith(".json")).sort();

const hash = crypto.createHash("sha256");
hash.update(`cyword-book-api-v${apiSchemaVersion}\0`);
const stableCatalog = { ...catalogSource };
delete stableCatalog.generatedAt;
hash.update(JSON.stringify(stableCatalog));
for (const name of wordNames) {
  hash.update(name);
  hash.update(fs.readFileSync(path.join(wordDir, name)));
}
const dataVersion = hash.digest("hex").slice(0, 16);
const versionRoot = path.join(outputRoot, dataVersion);
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(versionRoot, { recursive: true });

const groupsById = new Map(catalogSource.groups.map((group) => [group.id, group]));
const wordShard = {};
const shardWords = new Map();
for (const day of catalogSource.schedule) {
  const shard = String(day.day).padStart(2, "0");
  const ids = new Set();
  for (const groupId of day.groupIds) {
    const group = groupsById.get(groupId);
    if (!group) throw new Error(`Unknown group ${groupId} in study day ${day.day}`);
    for (const wordId of group.wordIds) {
      if (!(wordId in wordShard)) wordShard[wordId] = shard;
      if (wordShard[wordId] === shard) ids.add(wordId);
    }
  }
  shardWords.set(shard, ids);
}

if (Object.keys(wordShard).length !== wordNames.length) {
  throw new Error(`Shard index has ${Object.keys(wordShard).length} words; expected ${wordNames.length}`);
}

const catalog = { ...stableCatalog, dataVersion };
const manifest = {
  schemaVersion: apiSchemaVersion,
  bookCode,
  dataVersion,
  wordCount: wordNames.length,
  shards: Object.fromEntries([...shardWords].map(([shard, ids]) => [shard, ids.size])),
  wordShard,
};
const current = {
  schemaVersion: apiSchemaVersion,
  bookCode,
  dataVersion,
  catalogKey: `books/${bookCode}/${dataVersion}/catalog.json`,
};

fs.writeFileSync(path.join(versionRoot, "catalog.json"), JSON.stringify(catalog), "utf8");
fs.writeFileSync(path.join(versionRoot, "manifest.json"), JSON.stringify(manifest), "utf8");
for (const [shard, ids] of shardWords) {
  const words = {};
  for (const wordId of ids) {
    words[wordId] = JSON.parse(fs.readFileSync(path.join(wordDir, `${wordId}.json`), "utf8"));
  }
  fs.writeFileSync(
    path.join(versionRoot, `shard-${shard}.json`),
    JSON.stringify({ schemaVersion: apiSchemaVersion, bookCode, dataVersion, shard, words }),
    "utf8",
  );
}
fs.writeFileSync(path.join(outputRoot, "current.json"), JSON.stringify(current), "utf8");

const uploadFiles = [
  ...fs.readdirSync(versionRoot).sort().map((name) => ({
    key: `books/${bookCode}/${dataVersion}/${name}`,
    path: path.join(versionRoot, name),
  })),
  { key: `books/${bookCode}/current.json`, path: path.join(outputRoot, "current.json") },
];
const uploadManifest = uploadFiles.map((item) => ({
  ...item,
  bytes: fs.statSync(item.path).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(item.path)).digest("hex"),
}));
fs.writeFileSync(path.join(outputRoot, "upload-manifest.json"), JSON.stringify(uploadManifest, null, 2), "utf8");

const totalBytes = uploadManifest.reduce((sum, item) => sum + item.bytes, 0);
console.log(`Built ${uploadManifest.length} API objects for ${bookCode}@${dataVersion} (${totalBytes} bytes).`);
