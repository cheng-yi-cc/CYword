import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { signJWT } from '../website/server/auth.ts';
import { progressCatalog, progressProtocol } from '../website/server/progress-curriculum.ts';
import { restoreAccountSnapshot } from '../website/server/progress-store.ts';
import { emptyProgress, rateSearchWord, buildPlan, startReviewDay } from '../src/progress.ts';
import { packProgress } from '../website/server/progress-sync.ts';
import { ProgressSync } from '../src/sync-client.ts';
import { encodeProgressWire, decodeProgressWire } from '../src/progress-compression.ts';
import { fullProgressFixture } from './full-progress-fixture.ts';

async function fixture() {
  const bundle = await build({ stdin: { contents: `import {onRequest} from './website/functions/api/progress.ts'; export default {fetch(request,env){return onRequest({request,env})}};`, resolveDir: process.cwd(), sourcefile: 'sync-worker.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const secret = 'local-test-only-secret-with-at-least-32-characters';
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-31', d1Databases: ['DB'], bindings: { JWT_SECRET: secret } }));
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, last_login_at INTEGER, login_count INTEGER)').run();
  for (const name of ['0001_progress.sql', '0002_progress_snapshots.sql']) {
    const sql = await readFile(new URL(`../website/migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(item => item.trim())) await db.prepare(statement).run();
  }
  for (const id of ['a','b']) await db.prepare('INSERT INTO users VALUES (?, ?, 1, 1, 1)').bind(id, `${id}@example.test`).run();
  const a = await signJWT({ sub: 'a', email: 'a@example.test' }, secret);
  const b = await signJWT({ sub: 'b', email: 'b@example.test' }, secret);
  const request = (token, body, headers = {}) => mf.dispatchFetch('https://example.test/api/progress', { method: body ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify({ ...progressProtocol, ...body }) : undefined });
  return { db, a, b, request, close: () => mf.dispose() };
}
const word = progressCatalog.groups[0].wordIds[0];

test('complete book fits real D1, compressed transport round-trips and unchanged polling has no body', async () => {
  const f = await fixture();
  try {
    const progress = fullProgressFixture(progressCatalog);
    const headers = { 'X-CYword-Progress-Format': 'compact-v1' };
    const encoded = await encodeProgressWire(progress);
    assert.ok(JSON.stringify(encoded).length < 2_400_000);
    const response = await f.request(f.a, { revision: 0, progress: encoded }, headers);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.deepEqual(await decodeProgressWire(result.progress), progress);
    const stored = await f.db.prepare('SELECT length(payload) AS size FROM learning_progress WHERE user_id = ?').bind('a').first();
    assert.ok(stored.size < 1_800_000);
    const etag = `"1:${progressProtocol.bookCode}:${progressProtocol.curriculumVersion}:1"`;
    const unchanged = await f.request(f.a, undefined, { ...headers, 'If-None-Match': etag });
    assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
    assert.equal((await f.request(f.b, undefined, { ...headers, 'If-None-Match': etag })).status, 200, 'ETag cannot expose or reuse another account');
    assert.equal((await f.request(f.a, { revision: 1, progress: { encoding: 'cyword-gzip-v1', data: 'broken' } }, headers)).status, 400);
    assert.equal((await (await f.request(f.a, undefined, headers)).json()).revision, 1);
  } finally { await f.close(); }
});

test('real Worker + D1 protects identity, revisions, curriculum and existing records', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('invalid')).status, 401);
    const payload = { revision: 0, progress: rateSearchWord(emptyProgress(), word, 'unclear'), userId: 'b' };
    const writes = await Promise.all([f.request(f.a, payload), f.request(f.a, payload)]);
    assert.deepEqual(writes.map(r => r.status).sort(), [200,409]);
    const readA = await (await f.request(f.a)).json(), readB = await (await f.request(f.b)).json();
    assert.equal(readA.revision, 1); assert.ok(readA.progress.words[word]);
    assert.equal(readB.revision, 0); assert.deepEqual(readB.progress.words, {});
    for (const override of [{ protocol: 0 }, { bookCode: 'cet4' }, { curriculumVersion: 'unknown' }, { progress: { version: 2, words: null } },
      { progress: rateSearchWord(emptyProgress(), 'not-in-this-book', 'mastered') }]) {
      assert.equal((await f.request(f.a, { ...payload, revision: 1, ...override })).status, 400);
    }
    const stale = await f.request(f.a, { revision: 1, progress: emptyProgress() });
    assert.equal(stale.status, 200);
    const preserved = await stale.json();
    assert.equal(preserved.revision, 1, 'unchanged snapshots do not create duplicate revisions');
    assert.ok(preserved.progress.words[word], 'an empty upload cannot erase a saved word');
    const snapshots = await f.db.prepare('SELECT revision FROM progress_snapshots WHERE user_id = ?').bind('a').all();
    assert.equal(snapshots.results.length, 1);
  } finally { await f.close(); }
});

test('server refuses bypassed review prerequisites and derives completion from actual round records', async () => {
  const f = await fixture();
  try {
    const plan = buildPlan(progressCatalog);
    let progress = emptyProgress();
    for (const id of plan[3].reviewWordIds) progress = rateSearchWord(progress, id, 'unclear');
    progress = startReviewDay(progress, plan, 4, true);
    const blocked = structuredClone(progress); delete blocked.words[word];
    assert.equal((await f.request(f.a, { revision: 0, progress: blocked })).status, 400);
    progress.planDays[4].completedAt = new Date().toISOString();
    progress.planDays[4].reviewedWordIds = [...progress.planDays[4].reviewWordIds];
    const result = await f.request(f.a, { revision: 0, progress });
    assert.equal(result.status, 200);
    const stored = (await result.json()).progress;
    assert.equal(stored.planDays[4].completedAt, undefined);
    assert.deepEqual(stored.planDays[4].reviewedWordIds, []);
  } finally { await f.close(); }
});

test('isolated D1 account recovery preserves damaged bytes and restores a readable client snapshot', async () => {
  const f = await fixture();
  try {
    const progress = rateSearchWord(emptyProgress(), word, 'unmastered');
    assert.equal((await f.request(f.a, { revision: 0, progress })).status, 200);
    assert.equal((await f.request(f.b, { revision: 0, progress: rateSearchWord(emptyProgress(), word, 'mastered') })).status, 200);
    const beforeB = await (await f.request(f.b)).json();
    const snapshot = await f.db.prepare('SELECT slot FROM progress_snapshots WHERE user_id = ?').bind('a').first();
    const damaged = await packProgress({ version: 2, words: null });
    await f.db.prepare('UPDATE learning_progress SET payload = ?, revision = 2 WHERE user_id = ?').bind(damaged, 'a').run();
    assert.equal((await f.request(f.a)).status, 503);
    await assert.rejects(restoreAccountSnapshot(f.db, 'a', snapshot.slot, 1), /已改变/);
    const restored = await restoreAccountSnapshot(f.db, 'a', snapshot.slot, 2);
    assert.equal(restored.revision, 3);
    const archive = await f.db.prepare('SELECT payload FROM progress_recovery_archive WHERE id = ?').bind(restored.archiveId).first();
    assert.deepEqual(archive.payload, [...new Uint8Array(damaged)]);
    let disk = null;
    const client = new ProgressSync({ read: async () => null, write: async value => { disk = value; }, change: () => {}, request: async body => {
      const response = await f.request(f.a, body); return { status: response.status, data: await response.json() };
    } });
    await client.open();
    assert.equal(disk.words[word].proficiency, 'unmastered');
    assert.deepEqual(disk.localSync, { restored: true, pending: false });
    client.stop();
    assert.deepEqual(await (await f.request(f.b)).json(), beforeB, 'another account is unchanged');
  } finally { await f.close(); }
});
