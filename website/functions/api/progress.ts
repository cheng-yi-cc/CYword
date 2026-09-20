import { getUserFromRequest } from "../../server/auth.ts";
import { jsonError, readRequestJson } from "../../server/book-api.ts";
import { packProgress, unpackProgress, validProgress } from "../../server/progress-sync.ts";

const empty = () => ({ version: 2, words: {}, planDays: {}, bookmarks: {}, reviewHistory: [] });
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!["GET", "PUT"].includes(request.method)) return jsonError(405, "Method not allowed", { Allow: "GET, PUT" });
  if (!env.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) return jsonError(503, "同步服务暂时不可用");
  try {
    const user = await getUserFromRequest(request, env.DB, env.JWT_SECRET);
    if (!user) return jsonError(401, "登录已过期，请重新登录后同步");
    const read = async () => {
      const row = await env.DB.prepare("SELECT revision, payload FROM learning_progress WHERE user_id = ? AND book_code = ?").bind(user.id, "cet6").first<{ revision: number; payload: number[] }>();
      return row ? { revision: row.revision, progress: await unpackProgress(row.payload) } : { revision: 0, progress: empty() };
    };
    if (request.method === "GET") return reply(await read());
    let input: { revision?: unknown; progress?: unknown };
    try { input = await readRequestJson(request, 12_000_000); }
    catch (error) { return jsonError(error instanceof RangeError ? 413 : 400, "进度请求格式无效或过大"); }
    if (!input || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || !validProgress(input.progress)) return jsonError(400, "学习进度格式无效");
    const revision = Number(input.revision);
    const packed = await packProgress(input.progress);
    if (packed.byteLength > 1_800_000) return jsonError(413, "学习记录过大，请联系维护者处理，当前记录仍保留在设备上");
    const result = revision === 0
      ? await env.DB.prepare("INSERT INTO learning_progress (user_id, book_code, revision, payload, updated_at) VALUES (?, 'cet6', 1, ?, ?) ON CONFLICT(user_id, book_code) DO NOTHING").bind(user.id, packed, Date.now()).run()
      : await env.DB.prepare("UPDATE learning_progress SET revision = revision + 1, payload = ?, updated_at = ? WHERE user_id = ? AND book_code = 'cet6' AND revision = ?").bind(packed, Date.now(), user.id, revision).run();
    // The revision predicate makes simultaneous device writes atomic.
    if (!result.meta.changes) return reply(await read(), 409);
    return reply({ revision: revision + 1, progress: input.progress });
  } catch (error) {
    console.error("[CYWORD SYNC]", error instanceof Error ? error.message : "Unexpected failure");
    return jsonError(503, "同步暂时失败，进度已保留在当前设备，请稍后重试");
  }
};
