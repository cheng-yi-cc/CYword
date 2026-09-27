import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { progressToRecords, recordsToProgress } from '../src/progress-records.ts';
import { canonicalProgress } from '../src/progress-business.ts';
import { fullProgressFixture } from './full-progress-fixture.ts';
import { rateSearchWord } from '../src/progress.ts';

const catalog = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
test('full-book history round-trips through bounded per-word records', () => {
  const progress = fullProgressFixture(catalog), records = progressToRecords(progress);
  assert.equal(records.size, 5206);
  const largest = Math.max(...[...records.values()].map(r => Buffer.byteLength(JSON.stringify(r))));
  assert.ok(largest < 16000, `Record exceeded bounded request allowance: ${largest}`);
  assert.deepEqual(canonicalProgress(recordsToProgress(records.values()), catalog), progress);
});
test('one late full-book search rating changes only its word record', () => {
  const progress = fullProgressFixture(catalog), before = progressToRecords(progress);
  const id = Object.keys(progress.words)[0], next = canonicalProgress(rateSearchWord(progress, id, 'unmastered'), catalog);
  const after = progressToRecords(next);
  const changed = [...after.values()].filter(r => JSON.stringify(r) !== JSON.stringify(before.get(r.id)));
  assert.deepEqual(changed.map(r => r.id), [`w/${id}`]);
});
