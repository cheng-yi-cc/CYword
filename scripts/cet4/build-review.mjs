import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readCsv, serializeCsv } from './stage2-lib.mjs';
import { loadDrafts, expectedDraftProgress } from './draft-lib.mjs';

const dir = path.join(process.cwd(), 'authoring/cet4');
const read = file => readCsv(path.join(dir, file));
const frozen = read('wordlist.csv');
const { entries, batches, display } = loadDrafts();
const byId = new Map(entries.map(e => [e.wordId, e]));
const samples = ['001', '002', '003'].flatMap(n => JSON.parse(fs.readFileSync(path.join(dir, `sample/batch-${n}.json`))).entries);
const sampleById = new Map(samples.map(e => [e.wordId, e]));
const pilotFile=path.join(dir,'pilot/entries.json');
const pilotById=new Map(fs.existsSync(pilotFile)?JSON.parse(fs.readFileSync(pilotFile)).entries.map(e=>[e.wordId,e]):[]);
const selectionById=new Map(read('selection/crossbook.csv').map(e=>[e.word_id,e]));
const inflectionById=new Map(read('selection/inflection_review.csv').map(e=>[e.word_id,e]));
const selectionSummary=JSON.parse(fs.readFileSync(path.join(dir,'selection/summary.json')));
const refById = new Map(read('references/lexical.csv').map(e => [e.word_id, e]));
const six = readCsv('books/cet6/csv/words.csv');
const sixBySpelling = new Map(six.map(e => [e.spelling.toLowerCase(), e]));
const sources = new Map(read('source_entries.csv').map(s => [s.source_entry_id, s]));
const progress = read('progress.csv');
assert.equal(progress.length, frozen.length);
for (const p of progress) {
  if (byId.has(p.word_id)) Object.assign(p, expectedDraftProgress(byId.get(p.word_id)));
  if (sampleById.has(p.word_id)) p.updated_at = '2026-09-17';
}
fs.writeFileSync(path.join(dir, 'progress.csv'), serializeCsv(Object.keys(progress[0]), progress));
const all = frozen.map(w => {
  const draft = byId.get(w.word_id), sample = sampleById.get(w.word_id);
  const precedent = [w.canonical_spelling, ...JSON.parse(w.variants_json)].map(s => sixBySpelling.get(s.toLowerCase())).find(Boolean);
  const source = sources.get(w.first_source_entry_id);
  const reference = refById.get(w.word_id);
  assert.ok(reference, `Missing reference row ${w.word_id}`);
  return {
    id: w.word_id, spelling: display.get(w.word_id) ?? w.canonical_spelling, frozenSpelling: w.canonical_spelling,
    order: Number(w.word_order), variants: JSON.parse(w.variants_json),
    source: { page: source.pdf_page, printedPage: source.printed_page, row: source.row, column: source.column, role: w.source_roles },
    status: sample ? 'sample_reviewed' : draft ? 'validated_draft' : 'reference_only',
    inPilot:pilotById.has(w.word_id),
    selection:{...selectionById.get(w.word_id),inflectionReview:inflectionById.get(w.word_id)??null},
    original: sample ? { ...sample, notes: sample.rootAffixNotes } : pilotById.get(w.word_id) ?? draft ?? null,
    reference: { headword: reference.dictionary_headword, pronunciation: reference.phonetic_reference,
      definition: reference.translation_reference, issues: reference.issues, sourceId: reference.source_id },
    precedent: precedent ? { wordId: precedent.word_id, spelling: precedent.spelling, definition: precedent.definition_cn,
      memory: precedent.memory_markup, etymology: precedent.etymology_markup } : null,
  };
});
const summary = {
  schemaVersion: 1, wordlistVersion: 'cet4-2016-v1', updatedAt: '2026-09-17',
  status: 'in_progress', complete: false, totalWords: all.length,
  completeSampleWords: samples.length, originalDraftWords: entries.length,
  withOriginalMnemonic: all.filter(e => e.original?.memoryMarkup).length,
  remainingOriginalMnemonic: all.filter(e => !e.original?.memoryMarkup).length,
  matchedDictionaryReferences: all.filter(e => e.reference.headword).length,
  matchedCet6Precedents: all.filter(e => e.precedent).length,
  canonicalCet4Published: false,
  pilotWords:pilotById.size,selection:selectionSummary,
  limitation: '参考材料覆盖全词表；原创正文尚未覆盖全词表。新增正文为待二次复核初稿，不是可发布的完整四级词书。',
  batches,
};
const payload = { summary, words: all };
fs.writeFileSync(path.join(dir, 'content/manifest.json'), JSON.stringify(summary, null, 2) + '\n');
fs.mkdirSync(path.join(dir, 'review'), { recursive: true });
const json = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const template = fs.readFileSync('scripts/cet4/review-template.html', 'utf8');
assert.ok(template.includes('/* REVIEW_DATA */'));
fs.writeFileSync(path.join(dir, 'review/index.html'), template.replace('/* REVIEW_DATA */', () => `const DATA = ${json};`));
fs.writeFileSync(path.join(dir, 'review/coverage.json'), JSON.stringify(summary, null, 2) + '\n');
const plain = s => String(s ?? '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_, id, label) => label ?? id.replace(/^word:/, ''));
const md = ['# 四级原创正文审稿稿', '', summary.limitation, '', `已有 ${samples.length} 词样板，本轮新增 ${entries.length} 词初稿。全词表共 ${all.length} 词。`, ''];
for (const w of all.filter(w => w.original)) {
  const e = w.original;
  md.push(`## ${w.order}. ${w.spelling}`, '', `${e.pronunciation}　${e.definitionCn}`, '', `状态：${w.status === 'sample_reviewed' ? '既有样板，已改写巧记' : '原创初稿，待二次复核'}`, '', '### 巧记', '', plain(e.memoryMarkup), '', '### 用法', '', plain(e.notes), '');
  for (const x of e.examples) md.push(x.sentence, '', x.translation, '');
  for (const x of e.collocations) md.push(`${x.phrase}　${x.meaning}`, '');
  md.push('### 长句', '');
  for (const x of e.longSentences) md.push(x.sentence, '', x.translation, '', x.analysis ?? x.analyses.map(a => a.analysisText).join('\n\n'), '');
  md.push(`考纲定位：PDF 第 ${w.source.page} 页，印刷第 ${w.source.printedPage} 页，第 ${w.source.row} 行，第 ${w.source.column} 列。`, '');
}
fs.writeFileSync(path.join(dir, 'review/originals.md'), md.join('\n'));
const hashes = Object.fromEntries(six.length ? fs.readdirSync('books/cet6/csv').filter(n => n.endsWith('.csv')).sort().map(n => [n, crypto.createHash('sha256').update(fs.readFileSync(path.join('books/cet6/csv', n))).digest('hex')]) : []);
fs.writeFileSync(path.join(dir, 'review/cet6-source-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
