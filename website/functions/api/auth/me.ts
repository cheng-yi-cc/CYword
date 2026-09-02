import { jsonError } from "../../../server/book-api.ts";
import { getUserFromRequest } from "../../../server/auth.ts";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.DB) {
      console.error("[CYWORD AUTH] Missing DB binding");
      return jsonError(500, "数据库服务未配置（缺少 DB 绑定）");
    }

    const user = await getUserFromRequest(
      context.request,
      context.env.DB,
      context.env.JWT_SECRET,
    );

    if (!user) {
      return jsonError(401, "登录已失效，请重新登录");
    }

    return Response.json({
      success: true,
      user,
    }, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[CYWORD AUTH] me error:", error);
    return jsonError(500, error instanceof Error ? error.message : "服务端处理异常");
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return jsonError(405, "Method not allowed", { Allow: "GET" });
};
