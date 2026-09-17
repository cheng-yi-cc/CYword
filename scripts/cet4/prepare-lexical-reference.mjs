import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { readCsv, serializeCsv } from './stage2-lib.mjs';

// 参考层与原创教学层分开。导入词典不代表完成了逐词审稿。
const root = process.cwd();
const dir = path.join(root, 'authoring/cet4');
const cache = path.join(root, '.work/cet4/references');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const words = readCsv(path.join(dir, 'wordlist.csv'));
const input = fs.readFileSync(path.join(cache, 'ecdict.csv'));
const commit = JSON.parse(fs.readFileSync(path.join(cache, 'ecdict-commit.json'))).sha;
assert.match(commit, /^[a-f0-9]{40}$/);
const wanted = new Set(words.flatMap(w => [w.canonical_spelling, ...JSON.parse(w.variants_json)]).map(s => s.toLowerCase()));
const matches = new Map();
for (const row of parse(input, { columns: true, bom: true, skip_empty_lines: true })) {
  const key = row.word.toLowerCase();
  if (!wanted.has(key)) continue;
  if (!matches.has(key)) matches.set(key, []);
  matches.get(key).push(row);
}
const result = words.map(word => {
  const spellings = [word.canonical_spelling, ...JSON.parse(word.variants_json)];
  const candidates = spellings.flatMap(s => matches.get(s.toLowerCase()) ?? []);
  const exact = candidates.find(r => r.word === word.canonical_spelling);
  const selected = exact ?? candidates.find(r => spellings.includes(r.word)) ?? candidates[0];
  return {
    word_id: word.word_id, spelling: word.canonical_spelling,
    dictionary_headword: selected?.word ?? '',
    phonetic_reference: selected?.phonetic ?? '',
    translation_reference: selected?.translation?.replaceAll('\\n', '\n') ?? '',
    definition_en_reference: selected?.definition?.replaceAll('\\n', '\n') ?? '',
    inflections_reference: selected?.exchange ?? '',
    source_id: selected ? `ecdict-${commit.slice(0, 12)}` : '',
    match_method: !selected ? 'missing' : exact ? 'exact' : spellings.includes(selected.word) ? 'declared_variant' : 'case_insensitive',
    review_status: 'draft',
    issues: [!selected && '词典未命中', selected && !selected.phonetic && '音标缺失', selected && !selected.translation && '中文释义缺失', candidates.length > 1 && '存在多个字形候选，需核对词性义项'].filter(Boolean).join('；'),
  };
});
const out = path.join(dir, 'references');
fs.mkdirSync(out, { recursive: true });
const columns = Object.keys(result[0]);
fs.writeFileSync(path.join(out, 'lexical.csv'), serializeCsv(columns, result));
fs.copyFileSync(path.join(cache, 'ECDICT-LICENSE'), path.join(out, 'ECDICT-LICENSE'));
const summary = {
  source: 'ECDICT', commit, url: `https://github.com/skywind3000/ECDICT/tree/${commit}`,
  downloadedFile: `https://raw.githubusercontent.com/skywind3000/ECDICT/${commit}/ecdict.csv`,
  sha256: sha(input), license: 'MIT', retrievedAt: '2026-09-17',
  scope: '冻结词表的词典参考材料；不是原创释义，不是已审稿教学数据。音标保留上游原始记法，不擅自把口音统一为英音。',
  totalWords: words.length, matched: result.filter(r => r.dictionary_headword).length,
  withPhonetic: result.filter(r => r.phonetic_reference).length,
  missing: result.filter(r => !r.dictionary_headword).map(r => r.spelling),
  missingPhonetic: result.filter(r => r.dictionary_headword && !r.phonetic_reference).map(r => r.spelling),
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
