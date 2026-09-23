import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { jsonError } from "../book-api.ts";

declare global {
  interface Env {
    ACCESS_AUD: string;
    CF_ANALYTICS_TOKEN: string;
  }
}

export type AdminRole = "owner" | "operator" | "viewer";
export type Admin = { email: string; role: AdminRole };

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticateAdmin(request: Request, env: Env, keySetOverride?: JWTVerifyGetKey): Promise<Admin | Response> {
  if (!env.DB || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return jsonError(503, "管理后台尚未完成身份验证配置");
  }
  const domain = env.ACCESS_TEAM_DOMAIN.replace(/\/$/u, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/iu.test(domain)) {
    return jsonError(503, "管理后台身份验证配置无效");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return jsonError(401, "请先通过 Cloudflare Access 登录");
  try {
    let keySet: JWTVerifyGetKey | undefined = keySetOverride ?? keySets.get(domain);
    if (!keySet) {
      const remote = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
      keySets.set(domain, remote);
      keySet = remote;
    }
    const { payload } = await jwtVerify(token, keySet, { issuer: domain, audience: env.ACCESS_AUD, algorithms: ["RS256"] });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!email) return jsonError(403, "无法识别管理员邮箱");
    const principal = await env.DB.prepare("SELECT role FROM admin_principals WHERE email = ? AND enabled = 1")
      .bind(email).first<{ role: AdminRole }>();
    if (!principal || !["owner", "operator", "viewer"].includes(principal.role)) {
      return jsonError(403, "此账号没有管理后台权限");
    }
    return { email, role: principal.role };
  } catch (error) {
    console.error("[CYWORD ADMIN] Access validation failed:", error instanceof Error ? error.message : "Unknown error");
    return jsonError(403, "管理员身份验证失败");
  }
}

export function canManage(role: AdminRole): boolean {
  return role === "owner" || role === "operator";
}

export function checkWriteOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

export function adminJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
