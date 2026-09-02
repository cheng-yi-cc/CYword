import { jsonError, readRequestJson } from "./book-api.ts";

declare global {
  interface Env {
    RESEND_API_KEY?: string;
    JWT_SECRET?: string;
  }
}

export const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u;
export const OTP_PATTERN = /^\d{6}$/u;

const DEFAULT_JWT_SECRET = "cyword-jwt-secret-key-2026-fallback";
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

export async function signJWT(payload: Omit<JWTPayload, "iat" | "exp">, secret = DEFAULT_JWT_SECRET, expiresInSeconds = 30 * 24 * 3600): Promise<string> {
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

export async function verifyJWT(token: string, secret = DEFAULT_JWT_SECRET): Promise<JWTPayload | null> {
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

export async function sendOTPEmail(
  email: string,
  code: string,
  resendApiKey?: string,
): Promise<{ success: boolean; simulated?: boolean; message?: string }> {
  if (!resendApiKey) {
    console.log(`[CYWORD AUTH DEV/MOCK] OTP for ${email}: ${code}`);
    return { success: true, simulated: true, message: "本地模拟发信模式（未配置 RESEND_API_KEY）" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CYword <auth@chengyi.me>",
        to: email,
        subject: `【CYword】你的登录验证码是 ${code}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
            <div style="font-size: 24px; font-weight: 700; color: #0d9488; margin-bottom: 24px;">CYword 词根记忆</div>
            <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">您正在登录或注册 CYword，验证码如下：</p>
            <div style="background-color: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0f766e;">${code}</span>
            </div>
            <p style="font-size: 13px; color: #6b7280; line-height: 1.5;">验证码有效期为 5 分钟。如非本人操作，请忽略此邮件。</p>
          </div>
        `,
      }),
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
  resendApiKey?: string,
): Promise<{ success: boolean; error?: string; simulated?: boolean; debugCode?: string }> {
  await ensureAuthTables(db);
  const now = Math.floor(Date.now() / 1000);

  // 1. 检查是否存在未过期的验证码并检查 60s 重发冷却
  const existing = await db
    .prepare("SELECT code, expires_at, created_at FROM otp_codes WHERE email = ?")
    .bind(email)
    .first<{ code: string; expires_at: number; created_at: number }>();

  if (existing && now - existing.created_at < OTP_RESEND_COOLDOWN_SECONDS) {
    const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS - (now - existing.created_at);
    return { success: false, error: `请求过于频繁，请等待 ${waitSeconds} 秒后重试` };
  }

  // 2. 生成新验证码
  const code = generateOTP();
  const expiresAt = now + OTP_EXPIRY_SECONDS;

  // 3. 写入/覆盖 D1
  await db
    .prepare(
      `INSERT INTO otp_codes (email, code, expires_at, attempts, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET
         code = excluded.code,
         expires_at = excluded.expires_at,
         attempts = 0,
         created_at = excluded.created_at`
    )
    .bind(email, code, expiresAt, now)
    .run();

  // 4. 发送邮件
  const sendResult = await sendOTPEmail(email, code, resendApiKey);
  if (!sendResult.success) {
    return { success: false, error: sendResult.message };
  }

  return {
    success: true,
    simulated: sendResult.simulated,
    debugCode: sendResult.simulated ? code : undefined,
  };
}

export async function verifyAndAuthenticate(
  db: D1Database,
  email: string,
  code: string,
  jwtSecret?: string,
): Promise<{ success: boolean; token?: string; user?: AuthUser; error?: string }> {
  await ensureAuthTables(db);
  const now = Math.floor(Date.now() / 1000);

  // 1. 查询验证码
  const record = await db
    .prepare("SELECT code, expires_at, attempts FROM otp_codes WHERE email = ?")
    .bind(email)
    .first<{ code: string; expires_at: number; attempts: number }>();

  if (!record) {
    return { success: false, error: "请先获取验证码" };
  }

  if (record.expires_at < now) {
    await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();
    return { success: false, error: "验证码已过期，请重新获取" };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();
    return { success: false, error: "输错次数过多，验证码已作废，请重新获取" };
  }

  // 2. 核对验证码
  if (record.code !== code.trim()) {
    await db
      .prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?")
      .bind(email)
      .run();
    const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
    return {
      success: false,
      error: remaining > 0 ? `验证码错误，还剩 ${remaining} 次机会` : "验证码错误，已作废，请重新获取",
    };
  }

  // 3. 验证成功，删除验证码
  await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();

  // 4. 查询或创建用户
  const existingUser = await db
    .prepare("SELECT id, email, created_at, last_login_at, login_count FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; created_at: number; last_login_at: number; login_count: number }>();

  let user: AuthUser;
  if (existingUser) {
    const updatedCount = existingUser.login_count + 1;
    await db
      .prepare("UPDATE users SET last_login_at = ?, login_count = ? WHERE id = ?")
      .bind(now, updatedCount, existingUser.id)
      .run();
    user = {
      id: existingUser.id,
      email: existingUser.email,
      createdAt: existingUser.created_at,
      lastLoginAt: now,
      loginCount: updatedCount,
    };
  } else {
    const newId = crypto.randomUUID();
    await db
      .prepare("INSERT INTO users (id, email, created_at, last_login_at, login_count) VALUES (?, ?, ?, ?, 1)")
      .bind(newId, email, now, now)
      .run();
    user = {
      id: newId,
      email,
      createdAt: now,
      lastLoginAt: now,
      loginCount: 1,
    };
  }

  // 5. 签发 JWT
  const token = await signJWT({ sub: user.id, email: user.email }, jwtSecret || DEFAULT_JWT_SECRET);

  return { success: true, token, user };
}

export async function getUserFromRequest(
  request: Request,
  db: D1Database,
  jwtSecret?: string,
): Promise<AuthUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const payload = await verifyJWT(token, jwtSecret || DEFAULT_JWT_SECRET);
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
