import { jsonError, readRequestJson } from "../../../server/book-api.ts";
import { EMAIL_PATTERN, requestOTP } from "../../../server/auth.ts";

type SendCodeRequest = {
  email?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const contentLength = Number(context.request.headers.get("Content-Length") ?? "0");
    if (contentLength > 10_000) return jsonError(413, "Request is too large");

    let input: SendCodeRequest;
    try {
      input = await readRequestJson<SendCodeRequest>(context.request, 10_000);
    } catch {
      return jsonError(400, "无效的 JSON 请求格式");
    }

    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_PATTERN.test(email)) {
      return jsonError(400, "请输入有效的邮箱地址");
    }

    if (!context.env.DB) {
      console.error("[CYWORD AUTH] Missing DB binding");
      return jsonError(500, "数据库服务未配置（缺少 DB 绑定）");
    }

    if (!context.env.RESEND_API_KEY) {
      console.error("[CYWORD AUTH] Missing RESEND_API_KEY");
      return jsonError(503, "邮件服务暂时不可用，请稍后重试");
    }

    const result = await requestOTP(context.env.DB, email, context.env.RESEND_API_KEY);
    if (!result.success) {
      return jsonError(result.rateLimited ? 429 : 502, result.error || "发送验证码失败");
    }

    return Response.json({
      success: true,
      message: "验证码已发送至您的邮箱",
    }, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[CYWORD AUTH] send-code error:", error);
    return jsonError(500, error instanceof Error ? error.message : "服务端处理异常");
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return jsonError(405, "Method not allowed", { Allow: "POST" });
};
