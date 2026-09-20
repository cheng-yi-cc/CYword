import { jsonError, readRequestJson } from "./book-api.ts";

declare global {
  interface Env {
    RESEND_API_KEY: string;
    JWT_SECRET: string;
  }
}

export const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u;
export const OTP_PATTERN = /^\d{6}$/u;

const OTP_EXPIRY_SECONDS = 5 * 60; // 5 分钟
const OTP_RESEND_COOLDOWN_SECONDS = 60; // 60 秒重发冷却
const MAX_OTP_ATTEMPTS = 5; // 最多输错 5 次

export type AuthUser = {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number;
  loginCount: number;
};

export type JWTPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

export async function ensureAuthTables(_db: D1Database): Promise<void> {
  // 表结构已通过 migrations/0001_create_auth_tables.sql 迁移初始化
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJWT(payload: Omit<JWTPayload, "iat" | "exp">, secret: string, expiresInSeconds = 30 * 24 * 3600): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encoder = new TextEncoder();
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(dataToSign));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${dataToSign}.${encodedSignature}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const encoder = new TextEncoder();
    const dataToSign = `${headerB64}.${payloadB64}`;
    const key = await getHmacKey(secret);
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(dataToSign),
    );
    if (!valid) return null;

    const payloadText = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadText) as JWTPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

export function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const num = array[0] % 1_000_000;
  return num.toString().padStart(6, "0");
}

export function buildOTPEmail(email: string, code: string) {
  return {
    from: "CYword <login@auth.cyword.chengyi.me>",
    to: email,
    subject: `【CYword】你的登录验证码是 ${code}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #3d3929;">
        <div style="font-size: 24px; font-weight: 700; color: #d97757; margin-bottom: 24px;">CYword</div>
        <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">您正在登录或注册 CYword，验证码如下：</p>
        <div style="background-color: #fff6f1; border: 1px solid #f1d7ca; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #b85f43;">${code}</span>
        </div>
        <p style="font-size: 13px; color: #7a7668; line-height: 1.5;">验证码有效期为 5 分钟。如非本人操作，请忽略此邮件。</p>
      </div>
    `,
  };
}

export async function sendOTPEmail(
  email: string,
  code: string,
  resendApiKey: string,
): Promise<{ success: boolean; message?: string }> {
  if (!resendApiKey) {
    console.error("[CYWORD AUTH] Missing RESEND_API_KEY");
    return { success: false, message: "邮件服务暂时不可用，请稍后重试" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOTPEmail(email, code)),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[CYWORD AUTH] Resend API error:", errorData);
      return { success: false, message: "邮件服务发送失败，请稍后重试" };
    }

    return { success: true };
  } catch (error) {
    console.error("[CYWORD AUTH] Send email exception:", error);
    return { success: false, message: "网络异常，邮件发送失败" };
  }
}

export async function requestOTP(
  db: D1Database,
  email: string,
  resendApiKey: string,
  sendEmail = sendOTPEmail,
): Promise<{ success: boolean; error?: string; rateLimited?: boolean }> {
  await ensureAuthTables(db);
  const now = Math.floor(Date.now() / 1000);

  // 冷却检查与写入同一条语句执行，只有抢占成功的请求才发送邮件。
  const code = generateOTP();
  const expiresAt = now + OTP_EXPIRY_SECONDS;
  const claimed = await db.prepare(
    `INSERT INTO otp_codes (email, code, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at,
       attempts = 0, created_at = excluded.created_at
     WHERE otp_codes.created_at <= ?
     RETURNING email`
  ).bind(email, code, expiresAt, now, now - OTP_RESEND_COOLDOWN_SECONDS).first<{ email: string }>();
  if (!claimed) return { success: false, error: "请求过于频繁，请稍后重试", rateLimited: true };

  // 4. 发送邮件
  const sendResult = await sendEmail(email, code, resendApiKey);
  if (!sendResult.success) {
    // 只撤销本次发送失败的验证码，避免并发请求误删后来生成的验证码。
    await db.prepare("DELETE FROM otp_codes WHERE email = ? AND code = ?").bind(email, code).run();
    return { success: false, error: sendResult.message };
  }

  return { success: true };
}

export async function verifyAndAuthenticate(
  db: D1Database,
  email: string,
  code: string,
  jwtSecret: string,
): Promise<{ success: boolean; token?: string; user?: AuthUser; error?: string }> {
  await ensureAuthTables(db);
  const now = Math.floor(Date.now() / 1000);

  // 匹配、有效期、次数限制和核销必须原子执行，不能先 SELECT 再 DELETE。
  const consumed = await db.prepare(
    `DELETE FROM otp_codes WHERE email = ? AND code = ? AND expires_at >= ? AND attempts < ? RETURNING email`
  ).bind(email, code.trim(), now, MAX_OTP_ATTEMPTS).first<{ email: string }>();

  if (!consumed) {
    // 错误尝试也在数据库内累加，避免并发请求绕过次数限制。
    const failed = await db.prepare(
      `UPDATE otp_codes SET attempts = attempts + 1
       WHERE email = ? AND code != ? AND expires_at >= ? AND attempts < ? RETURNING attempts`
    ).bind(email, code.trim(), now, MAX_OTP_ATTEMPTS).first<{ attempts: number }>();
    if (failed) {
      const remaining = MAX_OTP_ATTEMPTS - failed.attempts;
      return { success: false, error: remaining > 0 ? `验证码错误，还剩 ${remaining} 次机会` : "验证码错误，已作废，请重新获取" };
    }
    return { success: false, error: "验证码已过期、已使用或已作废，请重新获取" };
  }

  // 唯一邮箱约束与登录次数递增由同一 UPSERT 保证，避免创建/更新竞态。
  const record = await db.prepare(
    `INSERT INTO users (id, email, created_at, last_login_at, login_count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at, login_count = users.login_count + 1
     RETURNING id, email, created_at, last_login_at, login_count`
  ).bind(crypto.randomUUID(), email, now, now).first<{ id: string; email: string; created_at: number; last_login_at: number; login_count: number }>();
  if (!record) throw new Error("账号保存失败，请重新登录");
  const user: AuthUser = { id: record.id, email: record.email, createdAt: record.created_at, lastLoginAt: record.last_login_at, loginCount: record.login_count };

  // 5. 签发 JWT
  const token = await signJWT({ sub: user.id, email: user.email }, jwtSecret);

  return { success: true, token, user };
}

export async function getUserFromRequest(
  request: Request,
  db: D1Database,
  jwtSecret: string,
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) return null;

  await ensureAuthTables(db);
  const user = await db
    .prepare("SELECT id, email, created_at, last_login_at, login_count FROM users WHERE id = ?")
    .bind(payload.sub)
    .first<{ id: string; email: string; created_at: number; last_login_at: number; login_count: number }>();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    loginCount: user.login_count,
  };
}
