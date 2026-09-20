import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  signJWT,
  verifyJWT,
  generateOTP,
  buildOTPEmail,
  requestOTP,
  sendOTPEmail,
  verifyAndAuthenticate,
  EMAIL_PATTERN,
  OTP_PATTERN,
} from "../website/server/auth.ts";

const TEST_JWT_SECRET = "test-secret-key-with-at-least-32-characters";

// Execute the actual SQL instead of reimplementing query behavior in a Map mock.
const authSchema = readFileSync(new URL("../migrations/0001_create_auth_tables.sql", import.meta.url), "utf8");
function createSqliteD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(authSchema);
  return {
    prepare(query: string) {
      let bound: Array<string | number | null> = [];
      const stmt = {
        bind(...args: Array<string | number | null>) { bound = args; return stmt; },
        async first() { const row = sqlite.prepare(query).get(...bound); return row ? { ...row } : null; },
        async run() { const result = sqlite.prepare(query).run(...bound); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

test("email & otp regex patterns validate correctly", () => {
  assert.ok(EMAIL_PATTERN.test("user@example.com"));
  assert.ok(EMAIL_PATTERN.test("test.name+tag@sub.domain.co"));
  assert.ok(!EMAIL_PATTERN.test("invalid-email"));
  assert.ok(!EMAIL_PATTERN.test("@domain.com"));

  assert.ok(OTP_PATTERN.test("123456"));
  assert.ok(!OTP_PATTERN.test("12345"));
  assert.ok(!OTP_PATTERN.test("1234567"));
  assert.ok(!OTP_PATTERN.test("abcdef"));
});

test("JWT signing and verification works with standard Web Crypto HMAC", async () => {
  const secret = TEST_JWT_SECRET;
  const payload = { sub: "user-123", email: "learner@cyword.test" };
  const token = await signJWT(payload, secret, 3600);

  assert.ok(typeof token === "string");
  assert.equal(token.split(".").length, 3);

  const verified = await verifyJWT(token, secret);
  assert.ok(verified !== null);
  assert.equal(verified?.sub, "user-123");
  assert.equal(verified?.email, "learner@cyword.test");

  // 篡改 Token 测试
  const tamperedToken = `${token.slice(0, -5)}abcde`;
  const tamperedResult = await verifyJWT(tamperedToken, secret);
  assert.equal(tamperedResult, null);

  // 过期 Token 测试
  const expiredToken = await signJWT(payload, secret, -10);
  const expiredResult = await verifyJWT(expiredToken, secret);
  assert.equal(expiredResult, null);
});

test("OTP flow: request code, cooldown limit, failure limit, and auto-registration", async () => {
  const db = createSqliteD1();
  const email = "student@university.edu";
  let otpCode = "";
  const fakeSendEmail = async (_email: string, code: string, apiKey: string) => {
    assert.equal(apiKey, "test-resend-key");
    otpCode = code;
    return { success: true };
  };

  // 1. 发送验证码
  const req1 = await requestOTP(db, email, "test-resend-key", fakeSendEmail);
  assert.equal(req1.success, true);
  assert.match(otpCode, /^\d{6}$/u);

  // 2. 立即重发应被 60s 频控拦截
  const req2 = await requestOTP(db, email, "test-resend-key", fakeSendEmail);
  assert.equal(req2.success, false);
  assert.ok(req2.error?.includes("请求过于频繁"));

  // 3. 错误验证码重试扣减次数
  const fail1 = await verifyAndAuthenticate(db, email, otpCode === "000000" ? "000001" : "000000", TEST_JWT_SECRET);
  assert.equal(fail1.success, false);
  assert.ok(fail1.error?.includes("验证码错误"));

  // 4. 正确验证码登录：首次登录自动创建账号
  const loginSuccess = await verifyAndAuthenticate(db, email, otpCode, TEST_JWT_SECRET);
  assert.equal(loginSuccess.success, true);
  assert.ok(loginSuccess.token);
  assert.equal(loginSuccess.user?.email, email);
  assert.equal(loginSuccess.user?.loginCount, 1);

  // 5. 验证码已被核销，不可重复使用
  const reuseAttempt = await verifyAndAuthenticate(db, email, otpCode, TEST_JWT_SECRET);
  assert.equal(reuseAttempt.success, false);
});

test("production email sender fails closed when RESEND_API_KEY is missing", async () => {
  const result = await sendOTPEmail("user@example.com", "123456", "");
  assert.equal(result.success, false);
  assert.equal("simulated" in result, false);
});

test("OTP email uses the CYword terracotta palette without the old tagline", () => {
  const email = buildOTPEmail("user@example.com", "123456");
  assert.match(email.html, />CYword<\/div>/u);
  assert.doesNotMatch(email.html, /词根记忆|#0d9488|#0f766e|#f0fdfa|#ccfbf1/iu);
  assert.match(email.html, /#d97757|#b85f43|#fff6f1|#f1d7ca/iu);
});

test("failed email delivery removes the unusable OTP and permits a retry", async () => {
  const db = createSqliteD1();
  const email = "retry@example.com";
  const failed = await requestOTP(db, email, "test-resend-key", async () => ({
    success: false,
    message: "邮件服务发送失败，请稍后重试",
  }));
  assert.equal(failed.success, false);

  const retried = await requestOTP(db, email, "test-resend-key", async () => ({ success: true }));
  assert.equal(retried.success, true);
});


test("real D1 atomically consumes OTPs and increments account login counts", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-08-31", d1Databases: ["DB"] }));
  try {
    const db = await mf.getD1Database("DB");
    for (const query of authSchema.split(";").filter((part) => part.trim())) await db.prepare(query).run();
    const email = "concurrent@example.test";
    let sent = 0, code = "";
    const send = async (_email: string, value: string) => { sent++; code = value; return { success: true }; };
    const requests = await Promise.all(Array.from({ length: 8 }, () => requestOTP(db, email, "test-key", send)));
    assert.equal(requests.filter((result) => result.success).length, 1);
    assert.equal(sent, 1);
    const results = await Promise.all(Array.from({ length: 12 }, () => verifyAndAuthenticate(db, email, code, TEST_JWT_SECRET)));
    assert.equal(results.filter((result) => result.success).length, 1);
    const first = results.find((result) => result.success)!;
    assert.equal(first.user?.loginCount, 1);
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("INSERT INTO otp_codes VALUES (?, '654321', ?, 0, ?)").bind(email, now + 300, now).run();
    const next = await verifyAndAuthenticate(db, email, "654321", TEST_JWT_SECRET);
    assert.equal(next.user?.id, first.user?.id);
    assert.equal(next.user?.loginCount, 2);
    await db.prepare("INSERT INTO otp_codes VALUES (?, '654321', ?, 0, ?)").bind(email, now + 300, now).run();
    await Promise.all(Array.from({ length: 12 }, () => verifyAndAuthenticate(db, email, "000000", TEST_JWT_SECRET)));
    assert.equal((await db.prepare("SELECT attempts FROM otp_codes WHERE email = ?").bind(email).first<{ attempts: number }>())?.attempts, 5);
    assert.equal((await verifyAndAuthenticate(db, email, "654321", TEST_JWT_SECRET)).success, false);
  } finally { await mf.dispose(); }
});
