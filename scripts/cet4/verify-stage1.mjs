import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const authoring = path.join(root, "authoring/cet4");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const csv = (dir, name) => parse(fs.readFileSync(path.join(dir, name), "utf8"), { columns: true, bom: true, skip_empty_lines: true });
const json = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));

export function validateRegistry(words, links, excluded, manifest, source) {
  const byId = new Map(words.map((w) => [w.word_id, w]));
  assert.equal(byId.size, words.length, "Duplicate word_id");
  assert.equal(new Set(words.map((w) => w.canonical_spelling.toLowerCase())).size, words.length, "Duplicate canonical spelling");
  assert.equal(manifest.uniqueLearningEntries, words.length);
  const sourceMap = new Map(source.map((r) => [r.source_entry_id, r]));
  const selected = new Set(source.filter((r) => r.head_is_cet6 === "false" && (manifest.includeListedRelated || r.entry_role === "headword")).map((r) => r.source_entry_id));
  assert.deepEqual(new Set(links.map((l) => l.source_entry_id)), selected, "Selected source coverage mismatch");
  const expectedExcluded = new Set(source.filter((r) => !selected.has(r.source_entry_id)).map((r) => r.source_entry_id));
  assert.deepEqual(new Set(excluded.map((r) => r.source_entry_id)), expectedExcluded, "Excluded source coverage mismatch");
  assert.equal(excluded.length, expectedExcluded.size);
  const linkKeys = new Set();
  const linkedWords = new Set();
  for (const l of links) {
    assert.ok(byId.has(l.word_id), `Orphan word source: ${l.word_id}`);
    const sourceRow = sourceMap.get(l.source_entry_id);
    assert.ok(sourceRow && sourceRow.head_is_cet6 === "false", "CET6 source leaked into CET4");
    assert.equal(l.entry_role, sourceRow.entry_role);
    assert.equal(l.source_homograph_number, sourceRow.homograph_number);
    assert.equal(l.canonical_spelling, byId.get(l.word_id).canonical_spelling);
    const key = `${l.word_id}/${l.source_entry_id}`;
    assert.ok(!linkKeys.has(key), "Duplicate source mapping");
    linkKeys.add(key);
    linkedWords.add(l.word_id);
  }
  assert.deepEqual(linkedWords, new Set(byId.keys()), "Untraceable word");
  const aliasOwners = new Map();
  for (const [index, w] of words.entries()) {
    assert.equal(Number(w.word_order), index + 1);
    assert.equal(w.word_id, `cet4-w-${sha(`cyword:cet4:${w.canonical_spelling.toLowerCase()}`).slice(0, 20)}`);
    const aliases = JSON.parse(w.variants_json);
    assert.ok(Array.isArray(aliases));
    for (const spelling of [w.canonical_spelling, ...aliases]) {
      const key = spelling.toLowerCase();
      assert.ok(!aliasOwners.has(key) || aliasOwners.get(key) === w.word_id, `Ambiguous alias: ${spelling}`);
      aliasOwners.set(key, w.word_id);
    }
    const own = links.filter((l) => l.word_id === w.word_id);
    assert.equal(own.length, Number(w.source_count));
    assert.ok(own.some((l) => l.source_entry_id === w.first_source_entry_id));
  }
  for (const spelling of ["a", "an", "prince", "princess", "insure", "ensure", "color"]) assert.ok(aliasOwners.has(spelling), `Missing scope edge case: ${spelling}`);
  assert.notEqual(aliasOwners.get("insure"), aliasOwners.get("ensure"));
  assert.notEqual(aliasOwners.get("prince"), aliasOwners.get("princess"));
  assert.equal(aliasOwners.get("color"), aliasOwners.get("colour"));
  assert.equal(aliasOwners.has("Celcius".toLowerCase()), false);
  if (manifest.includeListedRelated) {
    assert.ok(aliasOwners.has("ability"));
    assert.equal(aliasOwners.get("jewelry"), aliasOwners.get("jewellery"));
    assert.equal(aliasOwners.has("jewelery"), false);
  }
  return { uniqueLearningEntries: words.length, sourceLinks: links.length, excludedSourceEntries: excluded.length, orphanLinks: 0 };
}

function main() {
  const schema = json(authoring, "schema.json");
  const policy = csv(authoring, "field_policy.csv");
  const expectedFields = [];
  for (const [name, table] of Object.entries(schema.tables)) {
    const header = parse(fs.readFileSync(path.join(root, "books/cet6/csv", name), "utf8"), { to: 1, bom: true })[0];
    assert.deepEqual(table.columns, header, `Header differs from CET6: ${name}`);
    expectedFields.push(...header.map((field) => `${name}/${field}`));
  }
  assert.equal(Object.keys(schema.tables).length, 19);
  assert.equal(schema.actualFieldCount, 173);
  assert.equal(policy.length, 173);
  assert.deepEqual(new Set(policy.map((r) => `${r.table_file}/${r.field_name}`)), new Set(expectedFields));
  assert.ok(policy.every((r) => r.fill_method && r.required_when && r.rule && r.editorial_source_path));
  assert.equal(schema.sourceDictionarySha256, sha(fs.readFileSync(path.join(root, "books/cet6/csv/field_dictionary.csv"))));
  const source = csv(authoring, "source_entries.csv");
  const ids = new Map(source.map((r) => [r.source_entry_id, r]));
  assert.equal(ids.size, source.length);
  const audit = json(authoring, "extraction_audit.json");
  const proof = json(authoring, "source_verification.json");
  assert.equal(proof.matchedPages, 129);
  assert.equal(proof.sourceLedgerSha256, sha(fs.readFileSync(path.join(authoring, "source_entries.csv"))));
  assert.equal(proof.sourceSha256, audit.sourceSha256);
  let heads = 0;
  for (const r of source) {
    const head = ids.get(r.head_entry_id);
    assert.ok(head && head.entry_role === "headword", "Missing source headword");
    assert.equal(head.pdf_page, r.pdf_page);
    assert.equal(head.row, r.row);
    assert.equal(head.head_is_cet6, r.head_is_cet6);
    assert.equal(Number(r.printed_page), Number(r.pdf_page) - 5);
    assert.equal(r.source_entry_id, `cet2016-p${r.pdf_page.padStart(3, "0")}-r${r.row.padStart(2, "0")}-c${r.column}`);
    if (r.entry_role === "headword") {
      heads++;
      assert.equal(r.head_is_cet6, String(r.raw_text.includes("★")));
    }
  }
  assert.equal(heads, audit.visibleHeadwordRows);
  assert.equal(source.length - heads, audit.visibleListedRelatedEntries);
  for (let page = 21; page <= 149; page++) {
    assert.equal(source.filter((r) => Number(r.pdf_page) === page && r.entry_role === "headword").length, page === 149 ? 1 : 42);
  }
  const registryArg = process.argv.find((a) => a.startsWith("--registry="));
  const registry = registryArg ? path.resolve(registryArg.slice("--registry=".length)) : authoring;
  const report = { tables: 19, fieldRules: 173, sourceEntries: source.length, sourcePages: 129, registry: "not_frozen" };
  if (fs.existsSync(path.join(registry, "wordlist_manifest.json"))) {
    const words = csv(registry, "wordlist.csv");
    const links = csv(registry, "word_sources.csv");
    const excluded = csv(registry, "excluded_entries.csv");
    const manifest = json(registry, "wordlist_manifest.json");
    assert.equal(manifest.wordlistSha256, sha(fs.readFileSync(path.join(registry, "wordlist.csv"))));
    const canonicalRegistry = path.resolve(registry) === path.resolve(authoring);
    if (canonicalRegistry) {
      const decision = json(authoring, "scope_decision.json");
      assert.equal(decision.confirmed, true, "CET4 scope has not been confirmed");
      assert.equal(manifest.includeListedRelated, decision.includeListedRelated);
      assert.equal(manifest.uniqueLearningEntries, decision.expectedLearningEntries);
      assert.equal(manifest.wordlistVersion, decision.wordlistVersion);
      assert.equal(manifest.wordlistSha256, decision.expectedWordlistSha256, "Frozen wordlist changed");
      const progress = csv(registry, "progress.csv");
      assert.equal(progress.length, words.length);
      assert.deepEqual(new Set(progress.map((r) => r.word_id)), new Set(words.map((r) => r.word_id)), "Progress coverage mismatch");
      const spellings = new Map(words.map((w) => [w.word_id, w.canonical_spelling]));
      const validStates = new Set(["not_started", "draft", "validated", "reviewed", "not_applicable"]);
      for (const row of progress) {
        assert.equal(row.spelling, spellings.get(row.word_id));
        for (const field of ["base_status", "morphology_status", "sentences_status", "exam_status"]) assert.ok(validStates.has(row[field]), `Invalid progress status: ${field}`);
      }
      report.progressEntries = progress.length;
      report.scopeConfirmed = true;
    }
    const result = validateRegistry(words, links, excluded, manifest, source);
    Object.assign(report, result, { registry: canonicalRegistry ? "frozen_verified" : "candidate_verified" });
    if (process.argv.includes("--self-test")) {
      assert.throws(() => validateRegistry([...words, words[0]], links, excluded, manifest, source), /Duplicate word_id/);
      assert.throws(() => validateRegistry(words, links.slice(1), excluded, manifest, source));
      const leaked = structuredClone(links);
      leaked[0].source_entry_id = source.find((r) => r.head_is_cet6 === "true").source_entry_id;
      assert.throws(() => validateRegistry(words, leaked, excluded, manifest, source));
      report.rejectedInvalidFixtures = 3;
    }
  } else {
    assert.ok(!registryArg, "Requested candidate registry does not exist");
    assert.ok(process.argv.includes("--source-only"), "Wordlist is not frozen: decide the listed-related scope before marking stage 1 complete. Use --source-only only to check source/schema work.");
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
