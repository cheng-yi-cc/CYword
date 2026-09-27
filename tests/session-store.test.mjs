import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createSessionStore } from '../electron/session-store.cjs';

// Actual authenticated encryption stands in for the OS boundary; the integration
// smoke test exercises Electron/DPAPI itself on Windows.
function storage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}
const session = { token: 'test-secret-token', user: { id: 'student', email: 'student@example.test' } };

test('session migration atomically removes plaintext token while preserving account identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cyword-credentials-'));
  const target = path.join(directory, 'session.json');
  await writeFile(target, JSON.stringify(session));
  const store = createSessionStore(target, storage());
  assert.deepEqual(await store.read(), session);
  const raw = await readFile(target, 'utf8');
  assert.equal(raw.includes(session.token), false);
  assert.equal(JSON.parse(raw).user.id, session.user.id);
  assert.deepEqual(await store.read(), session);
  await store.clear();
  assert.equal(await store.read(), null);
});

test('empty, truncated and malformed sessions retain their originals through successful re-login', async () => {
  for (const damaged of ['', '{"version":', 'null', '{}', '{"version":1,"user":{"id":"student"},"encryptedToken":"broken"}']) {
    const directory = await mkdtemp(path.join(tmpdir(), 'cyword-damaged-session-'));
    const target = path.join(directory, 'session.json');
    await writeFile(target, damaged);
    const store = createSessionStore(target, storage());
    await assert.rejects(store.read(), /异常副本/);
    assert.equal(await readFile(target, 'utf8'), damaged);
    await assert.rejects(store.read());
    const preserved = (await readdir(directory)).filter(name => name.startsWith('session.json.corrupt-'));
    assert.equal(preserved.length, 1);
    await store.write(session);
    assert.deepEqual(await store.read(), session);
    assert.equal(await readFile(path.join(directory, preserved[0]), 'utf8'), damaged);
  }
});

test('unavailable encryption preserves the prior session and never falls back to plaintext', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cyword-credentials-'));
  const target = path.join(directory, 'session.json');
  const safe = storage(), store = createSessionStore(target, safe);
  await store.write(session);
  const encrypted = await readFile(target, 'utf8');
  safe.isEncryptionAvailable = () => false;
  await assert.rejects(store.write({ ...session, token: 'replacement' }), /凭据保护不可用/);
  assert.equal(await readFile(target, 'utf8'), encrypted);
  await assert.rejects(store.read(), /凭据保护不可用/);
  safe.isEncryptionAvailable = () => true;
  assert.deepEqual(await store.read(), session);
  const wrongKey = createSessionStore(target, storage());
  await assert.rejects(wrongKey.read());
  assert.equal(await readFile(target, 'utf8'), encrypted);
});
