import { jsonError, readRequestJson } from "../../../server/book-api.ts";
import { EMAIL_PATTERN, OTP_PATTERN, verifyAndAuthenticate } from "../../../server/auth.ts";

type VerifyCodeRequest = {
  email?: unknown;
  code?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
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

    if (!email || !EMAIL_PATTERN.test(email)) {
      return jsonError(400, "请输入有效的邮箱地址");
    }

    if (!code || !OTP_PATTERN.test(code)) {
      return jsonError(400, "请输入 6 位数字验证码");
    }

    if (!context.env.DB) {
      console.error("[CYWORD AUTH] Missing DB binding");
      return jsonError(500, "数据库服务未配置（缺少 DB 绑定）");
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
    console.error("[CYWORD AUTH] verify-code error:", error);
    return jsonError(500, error instanceof Error ? error.message : "服务端处理异常");
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return jsonError(405, "Method not allowed", { Allow: "POST" });
};
