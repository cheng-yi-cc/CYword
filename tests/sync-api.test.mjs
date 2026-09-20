import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { signJWT } from '../website/server/auth.ts';

test('real Worker + D1 validates identity, atomic revisions and compressed persistence', async () => {
  const bundle = await build({ stdin: { contents: `import {onRequest} from './website/functions/api/progress.ts'; export default {fetch(request,env){return onRequest({request,env})}};`, resolveDir: process.cwd(), sourcefile: 'sync-worker.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const secret = 'local-test-only-secret-with-at-least-32-characters';
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-31', d1Databases: ['DB'], bindings: { JWT_SECRET: secret } }));
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, last_login_at INTEGER, login_count INTEGER)').run();
    await db.prepare(await readFile(new URL('../website/migrations/0001_progress.sql', import.meta.url), 'utf8')).run();
    for (const id of ['a','b']) await db.prepare('INSERT INTO users VALUES (?, ?, 1, 1, 1)').bind(id, `${id}@example.test`).run();
    const a = await signJWT({ sub: 'a', email: 'a@example.test' }, secret);
    const b = await signJWT({ sub: 'b', email: 'b@example.test' }, secret);
    const request = (token, body) => mf.dispatchFetch('https://example.test/api/progress', { method: body ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await request('invalid')).status, 401);
    const payload = { revision: 0, progress: { version: 2, words: {}, planDays: {}, bookmarks: { w1: '2026-09-17T00:00:00.000Z' }, reviewHistory: [] } };
    const writes = await Promise.all([request(a, payload), request(a, payload)]);
    assert.deepEqual(writes.map(r=>r.status).sort(), [200,409]);
    const readA = await (await request(a)).json();
    assert.equal(readA.revision, 1); assert.ok(readA.progress.bookmarks.w1);
    const readB = await (await request(b)).json();
    assert.equal(readB.revision, 0); assert.deepEqual(readB.progress.bookmarks, {});
    assert.equal((await request(a, { revision: 1, progress: { version: 2, words: null } })).status, 400);
    payload.revision = 1; payload.progress.bookmarks = {};
    assert.equal((await request(a, payload)).status, 200);
    assert.equal((await (await request(a)).json()).revision, 2);
  } finally { await mf.dispose(); }
});
