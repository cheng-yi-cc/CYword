import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';
import { readCsv, serializeCsv, sha } from './stage2-lib.mjs';

const dir = 'authoring/cet4';
const out = path.join(dir, 'selection');
fs.mkdirSync(out, { recursive: true });
const frozen = readCsv(`${dir}/wordlist.csv`);
const six = readCsv('books/cet6/csv/words.csv');
const refs = new Map(readCsv(`${dir}/references/lexical.csv`).map(r => [r.word_id, r]));
const display = new Map(JSON.parse(fs.readFileSync(`${dir}/display_overrides.json`)).overrides.map(r => [r.wordId, r.displaySpelling]));
const lookup = new Map();
for (const w of frozen) for (const s of [w.canonical_spelling, ...JSON.parse(w.variants_json), display.get(w.word_id)].filter(Boolean)) {
  const key = s.toLowerCase();
  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key).push(w);
}
const sixBySpelling = new Map(six.map(w => [w.spelling.toLowerCase(), w]));
const cache = '.work/cet4/references/ecdict.csv';
const source = JSON.parse(fs.readFileSync(`${dir}/references/manifest.json`));
assert.equal(sha(fs.readFileSync(cache)), source.sha256, 'ECDICT snapshot changed');
const tagged = [];
const taggedTargets = new Set();
for await (const row of fs.createReadStream(cache).pipe(parse({columns:true,bom:true}))) {
  if (!row.tag.split(/\s+/u).includes('cet4')) continue;
  const matches = lookup.get(row.word.toLowerCase()) ?? [];
  for (const w of matches) taggedTargets.add(w.word_id);
  tagged.push({spelling:row.word, tags:row.tag, target_word_ids:JSON.stringify(matches.map(w=>w.word_id)),
    decision:matches.length ? 'in_selected_syllabus' : 'outside_selected_syllabus',
    reason:matches.length ? '与当前考纲词形或已登记拼写变体相符。' : 'ECDICT 标签仅作候选；所选考纲四级范围无对应词形，不自动加入。',
    translation_reference:row.translation.replaceAll('\\n','\n'), inflections_reference:row.exchange,
    source_id:`ecdict-${source.commit.slice(0,12)}`});
}
const crossbook = frozen.map(w => {
  const spellings = [w.canonical_spelling,...JSON.parse(w.variants_json)];
  const matches = spellings.map(s=>sixBySpelling.get(s.toLowerCase())).filter(Boolean);
  const match = matches[0];
  return {word_id:w.word_id, spelling:display.get(w.word_id)??w.canonical_spelling, source_roles:w.source_roles,
    ecdict_cet4_tag:String(taggedTargets.has(w.word_id)), cet6_word_id:match?.word_id??'', cet6_spelling:match?.spelling??'',
    match_method:!match?'none':match.spelling.toLowerCase()===w.canonical_spelling.toLowerCase()?'exact':'declared_variant',
    reuse_status:match?'pending_content_review':'new_content_required',
    reason:match?'同词命中仅建立审核入口；不自动复制释义、拆词或巧记。':'无六级同词；后续查找有证据的词族关系。'};
});
const matchedSixIds = new Set(crossbook.map(w=>w.cet6_word_id).filter(Boolean));
const sixOnly = six.filter(w=>!matchedSixIds.has(w.word_id)).map(w=>({word_id:w.word_id,spelling:w.spelling,reason:'当前四级词表及声明变体未直接匹配；不因此将六级词加入四级。'}));
const inflections = [];
const decisions = new Map(parseSync(fs.readFileSync(`${out}/inflection-decisions.tsv`,'utf8'),{columns:true,delimiter:'\t',quote:false}).map(r=>[r.spelling,r]));
const correctedSources = {
  dating:'https://dictionary.cambridge.org/dictionary/english/dating',
  founding:'https://dictionary.cambridge.org/dictionary/english/founding',
  funding:'https://dictionary.cambridge.org/us/dictionary/english/funding',
  retelling:'https://www.collinsdictionary.com/dictionary/english/retelling',
};
for (const w of frozen) {
  const ref=refs.get(w.word_id);
  const lemma=(ref?.inflections_reference??'').split('/').find(s=>s.startsWith('0:'))?.slice(2);
  if (!lemma || lemma.toLowerCase()===w.canonical_spelling.toLowerCase()) continue;
  const d=decisions.get(w.canonical_spelling);
  assert.ok(d?.independentSense,`Missing semantic decision: ${w.canonical_spelling}`);
  inflections.push({word_id:w.word_id,spelling:display.get(w.word_id)??w.canonical_spelling,lemma,
    source_roles:w.source_roles, translation_reference:ref.translation_reference,
    category:d.category,review_status:'editorial_reviewed', decision:'retain_independent',
    reason:d.independentSense, evidence:correctedSources[w.canonical_spelling]??`references/lexical.csv#${w.word_id}`,
    reviewed_at:'2026-09-17'});
}
assert.equal(inflections.length,decisions.size,'Unused or duplicate inflection decision');
for (const [file,rows,cols] of [
  ['ecdict_candidates.csv',tagged], ['crossbook.csv',crossbook], ['cet6_only.csv',sixOnly],
  ['inflection_review.csv',inflections],
]) fs.writeFileSync(`${out}/${file}`,serializeCsv(cols??Object.keys(rows[0]),rows));
const summary={schemaVersion:1,updatedAt:'2026-09-17',planConversationId:'6aab4728-9fc8-83ee-a584-7f3ef51a7fd9',
  selectionPolicy:'选定考纲范围；保留基础词、独立派生词；词形变化单独审义项；书外辅助词不计目标词数。',
  frozenWords:frozen.length,wordlistSha256:sha(fs.readFileSync(`${dir}/wordlist.csv`)),ecdictCommit:source.commit,
  ecdictCet4Candidates:tagged.length,ecdictCandidateRowsMatched:tagged.filter(r=>r.decision==='in_selected_syllabus').length,
  ecdictCandidatesOutsideSyllabus:tagged.filter(r=>r.decision==='outside_selected_syllabus').length,
  syllabusWordsWithCet4Tag:taggedTargets.size,syllabusWordsWithoutCet4Tag:frozen.length-taggedTargets.size,
  cet6Words:six.length,exactCrossbookMatches:crossbook.filter(w=>w.match_method==='exact').length,
  variantCrossbookMatches:crossbook.filter(w=>w.match_method==='declared_variant').length,
  crossbookMatches:crossbook.filter(w=>w.cet6_word_id).length,onlyCet4:crossbook.filter(w=>!w.cet6_word_id).length,
  onlyCet6:sixOnly.length,inflectionReviewCandidates:inflections.length,
  inflectionSemanticReviewComplete:true,scopeChanged:false,
  caveat:'各来源的计数分别保存；没有取并集或为了少于六级而删词。命中六级不等于已核准复用。'};
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
