import { getUserFromRequest } from "../../server/auth.ts";
import { jsonError, readRequestJson } from "../../server/book-api.ts";
import { validProgress } from "../../server/progress-sync.ts";
import { canonicalProgress } from "../../../src/progress-business.ts";
import { progressCatalog, progressProtocol } from "../../server/progress-curriculum.ts";
import { readStoredProgress, saveStoredProgress } from "../../server/progress-store.ts";
import { encodeProgressWire, decodeProgressWire } from "../../../src/progress-compression.ts";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const compact = request.headers.get("X-CYword-Progress-Format") === "compact-v1";
  const reply = async (data: { progress: unknown; revision: number }, status = 200) => Response.json({ ...progressProtocol, ...data, progress: compact ? await encodeProgressWire(data.progress) : data.progress }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (!["GET", "PUT"].includes(request.method)) return jsonError(405, "Method not allowed", { Allow: "GET, PUT" });
  if (!env.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) return jsonError(503, "同步服务暂时不可用");
  try {
    const user = await getUserFromRequest(request, env.DB, env.JWT_SECRET);
    if (!user) return jsonError(401, "登录已过期，请重新登录后同步");
    if (request.method === "GET" && request.headers.has("If-None-Match")) {
      const current = await env.DB.prepare("SELECT revision FROM learning_progress WHERE user_id = ? AND book_code = ?").bind(user.id, progressProtocol.bookCode).first<{ revision: number }>();
      const etag = `"${progressProtocol.protocol}:${progressProtocol.bookCode}:${progressProtocol.curriculumVersion}:${current?.revision ?? 0}"`;
      if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { "Cache-Control": "no-store", ETag: etag } });
    }
    if (request.method === "GET") return await reply(await readStoredProgress(env.DB, user.id));
    let input: { revision?: unknown; progress?: unknown; protocol?: unknown; bookCode?: unknown; curriculumVersion?: unknown };
    try { input = await readRequestJson(request, 12_000_000); }
    catch (error) { return jsonError(error instanceof RangeError ? 413 : 400, "进度请求格式无效或过大"); }
    try { if (input) input.progress = await decodeProgressWire(input.progress); }
    catch { return jsonError(400, "进度编码无效"); }
    if (!input || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || !validProgress(input.progress) || input.progress.localSync !== undefined) return jsonError(400, "学习进度格式无效");
    if (input.protocol !== progressProtocol.protocol || input.bookCode !== progressProtocol.bookCode || input.curriculumVersion !== progressProtocol.curriculumVersion) return jsonError(400, "同步协议或词书计划版本不匹配，请更新应用");
    let candidate;
    try { candidate = canonicalProgress(input.progress, progressCatalog); }
    catch (error) { return jsonError(400, error instanceof Error ? error.message : "学习记录与词书不匹配"); }
    const revision = Number(input.revision);
    const { status, ...snapshot } = await saveStoredProgress(env.DB, user.id, revision, candidate);
    return await reply(snapshot, status);
  } catch (error) {
    if (error instanceof RangeError) return jsonError(413, "学习记录过大，原记录仍保留，请联系维护者");
    console.error("[CYWORD SYNC]", error instanceof Error ? error.message : "Unexpected failure");
    return jsonError(503, "同步暂时失败，进度已保留在当前设备，请稍后重试");
  }
};
