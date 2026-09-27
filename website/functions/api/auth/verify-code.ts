import { jsonError, readRequestJson } from "../../../server/book-api.ts";
import { EMAIL_PATTERN, OTP_PATTERN, verifyAndAuthenticate } from "../../../server/auth.ts";
import { allowedAuthSource } from "../../../server/auth-guard.ts";

type VerifyCodeRequest = {
  email?: unknown;
  code?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!allowedAuthSource(context.request)) return jsonError(403, "请求来源无效，请从 CYword 重新登录");
    const contentLength = Number(context.request.headers.get("Content-Length") ?? "0");
    if (contentLength > 10_000) return jsonError(413, "Request is too large");

    let input: VerifyCodeRequest;
    try {
      input = await readRequestJson<VerifyCodeRequest>(context.request, 10_000);
    } catch {
      return jsonError(400, "无效的 JSON 请求格式");
    }

    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const code = typeof input.code === "string" ? input.code.trim() : "";

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return jsonError(400, "请输入有效的邮箱地址");
    }
    if (context.env.ACCEPTANCE_EMAIL && email !== context.env.ACCEPTANCE_EMAIL.trim().toLowerCase()) return jsonError(403, "此验收环境仅允许专用测试账号");

    if (!code || !OTP_PATTERN.test(code)) {
      return jsonError(400, "请输入 6 位数字验证码");
    }

    if (!context.env.DB) {
      console.error("[CYWORD AUTH] Missing DB binding");
      return jsonError(500, "数据库服务未配置（缺少 DB 绑定）");
    }

    if (!context.env.JWT_SECRET || context.env.JWT_SECRET.length < 32) {
      console.error("[CYWORD AUTH] Missing or weak JWT_SECRET");
      return jsonError(503, "认证服务暂时不可用，请稍后重试");
    }

    const result = await verifyAndAuthenticate(
      context.env.DB,
      email,
      code,
      context.env.JWT_SECRET,
    );

    if (!result.success || !result.token || !result.user) {
      return jsonError(400, result.error || "验证失败");
    }

    return Response.json({
      success: true,
      token: result.token,
      user: result.user,
    }, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[CYWORD AUTH] verify-code failed");
    return jsonError(503, "认证服务暂时不可用，请稍后重试");
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return jsonError(405, "Method not allowed", { Allow: "POST" });
};
