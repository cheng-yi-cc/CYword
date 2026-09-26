import { authenticateAdmin } from "../../../server/admin/access.ts";
import { handleAdminRequest } from "../../../server/admin/data.ts";
import { jsonError } from "../../../server/book-api.ts";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await authenticateAdmin(request, env);
  if (admin instanceof Response) return admin;
  try {
    return await handleAdminRequest(request, env, admin);
  } catch (error) {
    console.error("[CYWORD ADMIN] API failure:", error);
    return jsonError(503, "管理数据暂时不可用，请稍后刷新");
  }
};
