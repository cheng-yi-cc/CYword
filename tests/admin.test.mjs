import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { authenticateAdmin } from '../website/server/admin/access.ts';
import { handleAdminRequest } from '../website/server/admin/data.ts';
import { getUserFromRequest, signJWT } from '../website/server/auth.ts';

const secret = 'local-test-only-secret-with-at-least-32-characters';
const domain = 'https://cyword-test.cloudflareaccess.com';
const aud = 'cyword-admin-test-audience';

async function fixture() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: '2026-08-31', d1Databases: ['DB'] }));
  const db = await mf.getD1Database('DB');
  for (const file of ['../migrations/0001_create_auth_tables.sql', '../website/migrations/0001_progress.sql', '../website/migrations/0002_admin.sql']) {
    const sql = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const query of sql.split(';').filter((part) => part.trim())) await db.prepare(query).run();
  }
  await db.prepare("INSERT INTO users (id, email, created_at, last_login_at, login_count) VALUES ('user-1', 'student@example.test', 1, 1, 1)").run();
  return { mf, db, env: { DB: db, JWT_SECRET: secret, ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: aud } };
}

test('Access JWT requires a valid signature, audience and enabled admin role', async () => {
  const { mf, db, env } = await fixture();
  try {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    const token = (email, audience = aud) => new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(domain).setAudience(audience)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const request = (jwt) => new Request('https://example.test/api/admin/me', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });
    assert.equal((await authenticateAdmin(request(), env, jwks)).status, 401);
    assert.equal((await authenticateAdmin(request(await token('cyi907369@gmail.com', 'wrong-aud')), env, jwks)).status, 403);
    assert.equal((await authenticateAdmin(request(await token('not-admin@example.test')), env, jwks)).status, 403);
    assert.deepEqual(await authenticateAdmin(request(await token('cyi907369@gmail.com')), env, jwks), { email: 'cyi907369@gmail.com', role: 'owner' });
    await db.prepare("UPDATE admin_principals SET enabled = 0 WHERE email = 'cyi907369@gmail.com'").run();
    assert.equal((await authenticateAdmin(request(await token('cyi907369@gmail.com')), env, jwks)).status, 403);
  } finally { await mf.dispose(); }
});

test('suspension and revocation reject old cloud tokens and atomically record audit entries', async () => {
  const { mf, db, env } = await fixture();
  try {
    const admin = { email: 'cyi907369@gmail.com', role: 'owner' };
    const userRequest = async (token) => getUserFromRequest(new Request('https://example.test/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }), db, secret);
    const oldToken = await signJWT({ sub: 'user-1', email: 'student@example.test' }, secret);
    assert.ok(await userRequest(oldToken));
    const mutate = (action, reason = 'test reason', origin = 'https://example.test', role = admin) => handleAdminRequest(
      new Request(`https://example.test/api/admin/users/user-1/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }), env, role);
    assert.equal((await mutate('suspend', 'reason', 'https://attacker.test')).status, 403);
    assert.equal((await mutate('suspend', 'reason', 'https://example.test', { email: 'viewer@example.test', role: 'viewer' })).status, 403);
    assert.equal((await mutate('suspend')).status, 200);
    assert.equal(await userRequest(oldToken), null);
    assert.equal((await mutate('unsuspend')).status, 200);
    assert.equal(await userRequest(oldToken), null);
    const currentToken = await signJWT({ sub: 'user-1', email: 'student@example.test', tokenVersion: 2 }, secret);
    assert.ok(await userRequest(currentToken));
    assert.equal((await mutate('revoke')).status, 200);
    assert.equal(await userRequest(currentToken), null);
    const audit = await db.prepare('SELECT COUNT(*) AS count FROM admin_audit_logs WHERE target_user_id = ?').bind('user-1').first();
    assert.equal(audit.count, 3);
  } finally { await mf.dispose(); }
});
