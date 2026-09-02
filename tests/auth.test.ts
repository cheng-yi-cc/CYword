import assert from "node:assert/strict";
import test from "node:test";
import {
  signJWT,
  verifyJWT,
  generateOTP,
  requestOTP,
  verifyAndAuthenticate,
  EMAIL_PATTERN,
  OTP_PATTERN,
} from "../website/server/auth.ts";

// 创建轻量级内存 SQLite 模拟 D1
function createMockD1(): D1Database {
  const users = new Map<string, { id: string; email: string; created_at: number; last_login_at: number; login_count: number }>();
  const otpCodes = new Map<string, { email: string; code: string; expires_at: number; attempts: number; created_at: number }>();

  return {
    async exec(_query: string) {
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (query.includes("SELECT code, expires_at, created_at FROM otp_codes")) {
            const email = bound[0] as string;
            return (otpCodes.get(email) ?? null) as T | null;
          }
          if (query.includes("SELECT code, expires_at, attempts FROM otp_codes")) {
            const email = bound[0] as string;
            return (otpCodes.get(email) ?? null) as T | null;
          }
          if (query.includes("SELECT id, email, created_at, last_login_at, login_count FROM users WHERE email = ?")) {
            const email = bound[0] as string;
            return (users.get(email) ?? null) as T | null;
          }
          if (query.includes("SELECT id, email, created_at, last_login_at, login_count FROM users WHERE id = ?")) {
            const id = bound[0] as string;
            for (const user of users.values()) {
              if (user.id === id) return user as T;
            }
            return null;
          }
          return null;
        },
        async run() {
          if (query.includes("INSERT INTO otp_codes")) {
            const [email, code, expiresAt, createdAt] = bound as [string, string, number, number];
            otpCodes.set(email, { email, code, expires_at: expiresAt, attempts: 0, created_at: createdAt });
          } else if (query.includes("DELETE FROM otp_codes")) {
            const email = bound[0] as string;
            otpCodes.delete(email);
          } else if (query.includes("UPDATE otp_codes SET attempts = attempts + 1")) {
            const email = bound[0] as string;
            const item = otpCodes.get(email);
            if (item) item.attempts += 1;
          } else if (query.includes("INSERT INTO users")) {
            const [id, email, createdAt, lastLoginAt] = bound as [string, string, number, number];
            users.set(email, { id, email, created_at: createdAt, last_login_at: lastLoginAt, login_count: 1 });
          } else if (query.includes("UPDATE users SET last_login_at = ?, login_count = ?")) {
            const [lastLoginAt, loginCount, id] = bound as [number, number, string];
            for (const user of users.values()) {
              if (user.id === id) {
                user.last_login_at = lastLoginAt;
                user.login_count = loginCount;
                break;
              }
            }
          }
          return { success: true, meta: {} };
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async raw() {
          return [];
        },
      } as unknown as D1PreparedStatement;
      return stmt;
    },
    async batch() {
      return [];
    },
    async dump() {
      return new ArrayBuffer(0);
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
  const secret = "test-secret-key-123456";
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
  const db = createMockD1();
  const email = "student@university.edu";

  // 1. 发送验证码
  const req1 = await requestOTP(db, email);
  assert.equal(req1.success, true);
  assert.equal(req1.simulated, true);
  assert.ok(typeof req1.debugCode === "string" && req1.debugCode.length === 6);

  const otpCode = req1.debugCode!;

  // 2. 立即重发应被 60s 频控拦截
  const req2 = await requestOTP(db, email);
  assert.equal(req2.success, false);
  assert.ok(req2.error?.includes("请求过于频繁"));

  // 3. 错误验证码重试扣减次数
  const fail1 = await verifyAndAuthenticate(db, email, "000000");
  assert.equal(fail1.success, false);
  assert.ok(fail1.error?.includes("验证码错误"));

  // 4. 正确验证码登录：首次登录自动创建账号
  const loginSuccess = await verifyAndAuthenticate(db, email, otpCode);
  assert.equal(loginSuccess.success, true);
  assert.ok(loginSuccess.token);
  assert.equal(loginSuccess.user?.email, email);
  assert.equal(loginSuccess.user?.loginCount, 1);

  // 5. 验证码已被核销，不可重复使用
  const reuseAttempt = await verifyAndAuthenticate(db, email, otpCode);
  assert.equal(reuseAttempt.success, false);
});
