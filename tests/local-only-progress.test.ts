import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalProgress } from '../src/local-progress.ts';
import { emptyProgress, rateSearchWord } from '../src/progress.ts';
import type { AppProgress } from '../src/types.ts';

const catalog = { groups: [{ id: 'g', wordIds: ['a', 'b'] }], schedule: [{ day: 1, groupIds: ['g'], appearanceCount: 2, uniqueWordCount: 2 }] };
test('local progress starts empty, publishes only after durable save, and resumes without an account', async () => {
  let disk: AppProgress | null = null, shown: AppProgress | null = null;
  let unlock: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const adapter = { read: async () => disk, write: async (value: AppProgress) => { await gate; disk = structuredClone(value); return true; }, change: (value: AppProgress) => { shown = value; } };
  const local = new LocalProgress(catalog, adapter);
  await local.open();
  assert.deepEqual(shown!.words, {});
  gate = new Promise<void>(resolve => { unlock = resolve; });
  const saving = local.save(rateSearchWord(emptyProgress(), 'a', 'unclear'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(shown!.words, {});
  let exited = false;
  const flush = local.flush().then(result => { exited = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exited, false);
  unlock!(); await saving;
  assert.equal((await flush).localSaved, true);
  assert.equal(disk!.words.a.proficiency, 'unclear');
  await new LocalProgress(catalog, adapter).open();
  assert.equal(shown!.words.a.proficiency, 'unclear');
});

test('failed local saves never advance published progress and can be retried', async () => {
  let fail = false, shown = emptyProgress();
  const local = new LocalProgress(catalog, { read: async () => emptyProgress(), write: async () => !fail, change: value => { shown = value; } });
  await local.open(); fail = true;
  const next = rateSearchWord(shown, 'a', 'mastered');
  await assert.rejects(local.save(next), /保存失败/);
  assert.deepEqual(shown.words, {});
  assert.equal((await local.flush()).localSaved, false);
  fail = false; await local.save(next);
  assert.equal(shown.words.a.proficiency, 'mastered');
  assert.equal((await local.flush()).localSaved, true);
});

test('corrupt local records are never replaced by empty progress', async () => {
  let writes = 0;
  const local = new LocalProgress(catalog, { read: async () => ({ recoveryRequired: true }), write: async () => { writes++; return true; }, change: () => {} });
  await assert.rejects(local.open(), /损坏/);
  assert.equal(writes, 0);
});
