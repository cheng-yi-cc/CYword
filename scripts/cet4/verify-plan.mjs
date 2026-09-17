import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readCsv,registryKey} from './stage2-lib.mjs';
import {validateDependencies} from './dependency-graph.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const selection=read('authoring/cet4/selection/summary.json');
const cross=readCsv('authoring/cet4/selection/crossbook.csv');
assert.equal(cross.length,6161);assert.equal(new Set(cross.map(w=>w.word_id)).size,6161);
assert.equal(cross.filter(w=>w.cet6_word_id).length,selection.crossbookMatches);
assert.equal(hash('authoring/cet4/wordlist.csv'),selection.wordlistSha256);
const forms=readCsv('authoring/cet4/selection/inflection_review.csv');
assert.equal(forms.length,189);assert.ok(forms.every(r=>r.reason&&r.evidence&&r.review_status==='editorial_reviewed'));
const registry=readCsv('authoring/shared/morphemes.csv');
assert.equal(new Set(registry.map(registryKey)).size,registry.length);
assert.equal(hash('authoring/shared/morphemes.csv'),hash('authoring/cet4/morpheme_registry.csv'));
const byId=new Map(registry.map(r=>[r.root_id,r]));
const legacy=readCsv('authoring/shared/legacy_links.csv');
for(const link of legacy)assert.equal(registryKey(byId.get(link.shared_root_id)),link.shared_key);
for(const w of ['character','faculty','portion','spice','spicy'])assert.ok(!legacy.some(l=>l.spelling===w),`Unsafe crossbook reuse ${w}`);
const pack=read('authoring/cet4/pilot/entries.json');
assert.equal(pack.entries.length,100);assert.equal(pack.status,'editorial_trial');
const edges=readCsv('authoring/cet4/pilot/dependencies.csv');
validateDependencies(pack.entries.map(e=>e.wordId),edges);
const catalog=read('.work/cet4/pilot-data/catalog.json');
assert.equal(catalog.stats.wordCount,100);assert.equal(catalog.book.code,'cet4');
assert.ok(catalog.groups.filter(g=>g.kind==='root').every(g=>g.wordCount>=2),'Single-word roots should remain in details for this trial');
const positions=new Map();let pos=0;
for(const day of catalog.schedule)for(const gid of day.groupIds){
  const g=catalog.groups.find(g=>g.id===gid);assert.ok(g);
  for(const wid of g.wordIds){if(!positions.has(wid))positions.set(wid,pos);pos++;}
}
for(const e of edges)assert.ok(positions.get(e.prerequisite_word_id)<positions.get(e.word_id),`Prerequisite scheduled too late: ${e.spelling}`);
const samples=pack.entries.filter(e=>e.status!=='validated_draft');
assert.equal(samples.length,30);
for(const e of pack.entries){
  for(const x of e.longSentences){assert.equal(x.segments.map(s=>s.text).join(''),x.sentence);assert.ok(x.segments.every(s=>s.gloss));}
}
const baseline=read('authoring/cet4/review/cet6-source-hashes.json');
for(const [name,h]of Object.entries(baseline))assert.equal(hash(`books/cet6/csv/${name}`),h,`CET6 changed: ${name}`);
console.log(JSON.stringify({selectedWords:cross.length,semanticDecisions:forms.length,sharedMorphemes:registry.length,
  legacyMappedOccurrences:legacy.length,pilotWords:100,verifiedPrerequisiteOrder:edges.length,cet6:'unchanged',completeBook:false},null,2));
