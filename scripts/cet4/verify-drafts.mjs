import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { loadDrafts, expectedDraftProgress } from './draft-lib.mjs';
import { readCsv } from './stage2-lib.mjs';

const dir = 'authoring/cet4';
const { entries } = loadDrafts();
const progress = new Map(readCsv(`${dir}/progress.csv`).map(r => [r.word_id, r]));
const frozenManifest = JSON.parse(fs.readFileSync(`${dir}/wordlist_manifest.json`));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(`${dir}/wordlist.csv`), frozenManifest.wordlistSha256, 'Frozen wordlist changed');
for (const entry of entries) {
  for (const [field, value] of Object.entries(expectedDraftProgress(entry))) {
    assert.equal(progress.get(entry.wordId)?.[field], value, `Progress mismatch ${entry.spelling}.${field}`);
  }
  assert.ok(!entry.memoryMarkup.includes('针对第'), `${entry.spelling}: mechanical mnemonic opening`);
  assert.ok(!/图片|如图所示/u.test(entry.memoryMarkup), `${entry.spelling}: missing image dependency`);
}
const manifest = JSON.parse(fs.readFileSync(`${dir}/content/manifest.json`));
assert.equal(manifest.originalDraftWords, entries.length);
assert.equal(manifest.complete, false, 'Incomplete drafts must not be advertised as complete');
assert.equal(manifest.withOriginalMnemonic + manifest.remainingOriginalMnemonic, manifest.totalWords);
const html = fs.readFileSync(`${dir}/review/index.html`, 'utf8');
assert.ok(!html.includes('/* REVIEW_DATA */'), 'Review payload not embedded');
const script = html.match(/<script>([\s\S]*)<\/script>/u)?.[1];
assert.ok(script);
new vm.Script(script); // Validate syntax without granting page code Node access.

// Keep these rejected fixtures in .work per the user's cleanup preference.
const fixtureRoot = path.resolve('.work/cet4/draft-validation');
const fixtureDir = path.join(fixtureRoot, dir);
fs.mkdirSync(path.join(fixtureDir, 'content'), {recursive:true});
fs.mkdirSync(path.join(fixtureDir, 'references'), {recursive:true});
for (const name of ['wordlist.csv', 'display_overrides.json', 'references/lexical.csv', 'references/supplements.json']) {
  fs.copyFileSync(path.join(dir,name),path.join(fixtureDir,name));
}
const first = fs.readFileSync(`${dir}/content/a01.tsv`,'utf8').split(/\r?\n/u);
const firstReading = fs.readFileSync(`${dir}/content/a01-reading.tsv`,'utf8').split(/\r?\n/u);
const fixture = path.join(fixtureDir,'content/fixture.tsv'), reading = path.join(fixtureDir,'content/fixture-reading.tsv');
fs.writeFileSync(fixture, first.slice(0,2).join('\n')+'\n');
fs.writeFileSync(reading, firstReading.slice(0,2).join('\n')+'\n');
assert.equal(loadDrafts(fixtureRoot).entries.length,1);
fs.writeFileSync(fixture, [first[0],first[1],first[1]].join('\n')+'\n');
assert.throws(()=>loadDrafts(fixtureRoot), /coverage differs/);
fs.writeFileSync(fixture,first.slice(0,2).join('\n').replace('I bought a notebook for the course.','Each notebook was ready.')+'\n');
assert.throws(()=>loadDrafts(fixtureRoot), /example does not contain/); // "a" inside Each cannot count.
fs.writeFileSync(fixture,first.slice(0,2).join('\n')+'\n');
fs.writeFileSync(reading,firstReading.slice(0,2).join('\n').replace('\ta\t','\tmissing-word\t')+'\n');
assert.throws(()=>loadDrafts(fixtureRoot), /target absent/);
fs.writeFileSync(reading,firstReading.slice(0,2).join('\n').replace('subj::','invalid-role::')+'\n');
assert.throws(()=>loadDrafts(fixtureRoot), /invalid segment role/);

console.log(JSON.stringify({originalDrafts:entries.length,ordinaryExamples:entries.length,longSentences:entries.length,
  readingSections:entries.reduce((n,e)=>n+e.longSentences[0].segments.length,0),frozenWordlist:'unchanged',
  reviewScript:'syntax_valid',rejectedInvalidFixtures:4,complete:false},null,2));
