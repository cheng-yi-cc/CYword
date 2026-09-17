import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readCsv, serializeCsv, registryKey, sha } from './stage2-lib.mjs';
const shared='authoring/shared';
const registry=readCsv(`${shared}/morphemes.csv`);
const byKey=new Map(registry.map(r=>[registryKey(r),r]));
const evidence=readCsv('authoring/cet4/evidence.csv');
const evidenceIds=new Set(evidence.map(e=>e.evidence_id));
for(const m of registry){
  assert.equal(m.root_id,`cy-morph-${sha(registryKey(m)).slice(0,20)}`);
  for(const ref of JSON.parse(m.evidence_refs))assert.ok(evidenceIds.has(ref),`Missing evidence ${ref}`);
}
const decisions=JSON.parse(fs.readFileSync(`${shared}/legacy-decisions.json`));
const words=readCsv('books/cet6/csv/words.csv');
const spellings=new Map(words.map(w=>[w.word_id,w.spelling]));
const roots=readCsv('books/cet6/csv/root_markups.csv');
const links=[];
for(const d of decisions.mappings){
  const canonical=byKey.get(d.sharedKey);assert.ok(canonical,`Unknown shared morpheme ${d.sharedKey}`);
  for(const spelling of d.words){
    const old=roots.filter(r=>spellings.get(r.word_id)===spelling&&r.spelling===d.legacyForm);
    assert.equal(old.length,1,`Ambiguous or missing legacy occurrence ${spelling}/${d.legacyForm}`);
    assert.equal(old[0].root_type,canonical.root_type,'Morpheme type mismatch');
    links.push({book_code:'cet6',word_id:old[0].word_id,spelling,legacy_root_id:old[0].root_id,legacy_form:d.legacyForm,
      shared_root_id:canonical.root_id,shared_key:d.sharedKey,review_status:'identity_reviewed',
      evidence_refs:JSON.stringify(d.evidence),scope:'此处确认词族身份，不表示旧正文及整段拆解通过审核。'});
  }
}
const held=[];
for(const d of decisions.heldCases)for(const spelling of d.words){
  const old=roots.find(r=>spellings.get(r.word_id)===spelling&&r.spelling===d.legacyForm);assert.ok(old);
  held.push({book_code:'cet6',word_id:old.word_id,spelling,legacy_root_id:old.root_id,legacy_form:d.legacyForm,
    decision:'hold_for_reanalysis',reason:d.reason,reference_url:d.url});
}
const occurrenceKeys=links.map(r=>`${r.word_id}|${r.legacy_root_id}`);
assert.equal(new Set(occurrenceKeys).size,occurrenceKeys.length,'Duplicate legacy mapping');
assert.ok(held.every(r=>!occurrenceKeys.includes(`${r.word_id}|${r.legacy_root_id}`)),'Held case accidentally mapped');
for(const [file,rows]of [['legacy_links.csv',links],['legacy_issues.csv',held]])fs.writeFileSync(`${shared}/${file}`,serializeCsv(Object.keys(rows[0]),rows));
// Compatibility projection: the common registry is authoritative; existing CET4 tools can still read the old path.
fs.copyFileSync(`${shared}/morphemes.csv`,'authoring/cet4/morpheme_registry.csv');
const usedEvidence=new Set(registry.flatMap(r=>JSON.parse(r.evidence_refs)));
fs.writeFileSync(`${shared}/evidence.csv`,serializeCsv(Object.keys(evidence[0]),evidence.filter(r=>usedEvidence.has(r.evidence_id))));
const summary={schemaVersion:1,sharedMorphemes:registry.length,confirmedLegacyOccurrences:links.length,heldLegacyOccurrences:held.length,
  legacyUniqueElements:new Set(roots.map(r=>r.root_id)).size,legacyBookModified:false,
  note:'逐词桥接，不全局改写六级 ID。其他旧构词尚未审核，不得按同字母直接复用。'};
fs.writeFileSync(`${shared}/manifest.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary);
