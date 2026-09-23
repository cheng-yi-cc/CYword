import { readRequestJson, jsonError } from "../book-api.ts";
import { adminJson, canManage, checkWriteOrigin, type Admin } from "./access.ts";
import { getResources } from "./resources.ts";

type UserRow = {
  id: string; email: string; created_at: number; last_login_at: number; login_count: number;
  status: string; status_reason: string | null; status_changed_at: number | null;
  token_version: number; is_test: number; admin_note: string; admin_revision: number;
};

const replyError = (status: number, message: string) => jsonError(status, message);
const epochIso = (seconds: number | null) => seconds == null ? null : new Date(seconds * 1000).toISOString();
const SHANGHAI_OFFSET = 8 * 3600;
const DAY = 86400;
const dayStart = (now: number) => Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY - SHANGHAI_OFFSET;
const dayLabel = (start: number) => new Date((start + SHANGHAI_OFFSET) * 1000).toISOString().slice(0, 10);

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function formatUser(row: UserRow, detail: boolean, admin: Admin) {
  return {
    id: row.id, email: detail && canManage(admin.role) ? row.email : maskEmail(row.email),
    createdAt: epochIso(row.created_at), lastLoginAt: epochIso(row.last_login_at),
    loginCount: row.login_count, status: row.status, statusReason: detail && canManage(admin.role) ? row.status_reason : null,
    statusChangedAt: epochIso(row.status_changed_at), isTest: Boolean(row.is_test),
    adminNote: detail && canManage(admin.role) ? row.admin_note : undefined,
  };
}

async function overview(db: D1Database, url: URL) {
  const now = Math.floor(Date.now() / 1000);
  const today = dayStart(now);
  const includeTest = url.searchParams.get("includeTest") === "1";
  const testWhere = includeTest ? "" : " AND is_test = 0";
  const eventTestWhere = includeTest ? "" : " AND u.is_test = 0";
  const [counts, growth, logins, recent] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_today,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
      SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
      FROM users WHERE 1=1 ${testWhere}`).bind(today, today - 6 * DAY).first<{ total: number; new_today: number; new_7d: number; suspended: number }>(),
    db.prepare(`SELECT date(created_at + 28800, 'unixepoch') AS day, COUNT(*) AS count
      FROM users WHERE created_at >= ? ${testWhere} GROUP BY day ORDER BY day`).bind(today - 29 * DAY).all<{ day: string; count: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT CASE WHEN e.created_at >= ? THEN e.user_id END) AS today,
      COUNT(DISTINCT e.user_id) AS last_7d, COUNT(*) AS login_events_7d
      FROM auth_events e JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ? ${eventTestWhere}`).bind(today, today - 6 * DAY).first<{ today: number; last_7d: number; login_events_7d: number }>(),
    db.prepare(`SELECT id, email, created_at, last_login_at, login_count, status, status_reason, status_changed_at,
      token_version, is_test, admin_note, admin_revision FROM users WHERE 1=1 ${testWhere} ORDER BY created_at DESC LIMIT 6`).all<UserRow>(),
  ]);
  const points = new Map(growth.results.map((row) => [row.day, row.count]));
  return adminJson({
    timezone: "Asia/Shanghai", generatedAt: new Date().toISOString(), includeTest,
    counts: { total: counts?.total ?? 0, newToday: counts?.new_today ?? 0, new7d: counts?.new_7d ?? 0,
      suspended: counts?.suspended ?? 0, loginToday: logins?.today ?? 0, login7d: logins?.last_7d ?? 0,
      loginEvents7d: logins?.login_events_7d ?? 0 },
    growth: Array.from({ length: 30 }, (_, i) => {
      const day = dayLabel(today - (29 - i) * DAY);
      return { day, count: points.get(day) ?? 0 };
    }),
    recentUsers: recent.results.map((row) => ({ id: row.id, email: maskEmail(row.email), createdAt: epochIso(row.created_at), status: row.status })),
    loginHistorySince: "后台启用后",
  });
}

async function listUsers(db: D1Database, url: URL, admin: Admin) {
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  const status = url.searchParams.get("status") ?? "all";
  if (!["all", "active", "suspended"].includes(status)) return replyError(400, "账号状态筛选无效");
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const size = [20, 50, 100].includes(Number(url.searchParams.get("size"))) ? Number(url.searchParams.get("size")) : 20;
  const includeTest = url.searchParams.get("includeTest") === "1";
  const sort = url.searchParams.get("sort") ?? "created";
  const order = ({ created: "created_at", login: "last_login_at", frequency: "login_count" } as Record<string, string>)[sort];
  if (!order) return replyError(400, "排序方式无效");
  const conditions = ["(instr(lower(email), lower(?)) > 0 OR instr(id, ?) > 0)"];
  const binds: Array<string | number> = [search, search];
  if (status !== "all") { conditions.push("status = ?"); binds.push(status); }
  if (!includeTest) conditions.push("is_test = 0");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/u.test(from)) { conditions.push("created_at >= ?"); binds.push(Date.parse(`${from}T00:00:00+08:00`) / 1000); }
  if (to && /^\d{4}-\d{2}-\d{2}$/u.test(to)) { conditions.push("created_at < ?"); binds.push(Date.parse(`${to}T00:00:00+08:00`) / 1000 + DAY); }
  const where = conditions.join(" AND ");
  const [total, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${where}`).bind(...binds).first<{ count: number }>(),
    db.prepare(`SELECT id, email, created_at, last_login_at, login_count, status, status_reason, status_changed_at,
      token_version, is_test, admin_note, admin_revision FROM users WHERE ${where} ORDER BY ${order} DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, size, (page - 1) * size).all<UserRow>(),
  ]);
  return adminJson({ users: rows.results.map((row) => formatUser(row, false, admin)), total: total?.count ?? 0, page, size });
}

async function userDetail(db: D1Database, id: string, admin: Admin) {
  const [row, progress, events, audit] = await Promise.all([
    db.prepare(`SELECT id, email, created_at, last_login_at, login_count, status, status_reason, status_changed_at,
      token_version, is_test, admin_note, admin_revision FROM users WHERE id = ?`).bind(id).first<UserRow>(),
    db.prepare("SELECT book_code, revision, updated_at, length(payload) AS bytes FROM learning_progress WHERE user_id = ? ORDER BY updated_at DESC")
      .bind(id).all<{ book_code: string; revision: number; updated_at: number; bytes: number }>(),
    db.prepare("SELECT kind, created_at FROM auth_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
      .bind(id).all<{ kind: string; created_at: number }>(),
    db.prepare("SELECT actor_email, action, reason, created_at FROM admin_audit_logs WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 20")
      .bind(id).all<{ actor_email: string; action: string; reason: string; created_at: number }>(),
  ]);
  if (!row) return replyError(404, "用户不存在");
  return adminJson({ user: formatUser(row, true, admin),
    cloudProgress: progress.results.map((p) => ({ bookCode: p.book_code, revision: p.revision, updatedAt: new Date(p.updated_at).toISOString(), bytes: p.bytes })),
    events: events.results.map((e) => ({ kind: e.kind, at: epochIso(e.created_at) })),
    audit: audit.results.map((a) => ({ actorEmail: a.actor_email, action: a.action, reason: a.reason, at: epochIso(a.created_at) })),
  });
}

async function mutateUser(request: Request, db: D1Database, id: string, action: string, admin: Admin) {
  if (!canManage(admin.role)) return replyError(403, "当前角色没有修改用户的权限");
  if (!checkWriteOrigin(request)) return replyError(403, "请求来源未通过验证");
  let input: { reason?: unknown; note?: unknown; isTest?: unknown };
  try { input = await readRequestJson(request, 4096); }
  catch { return replyError(400, "请求格式无效"); }
  const row = await db.prepare("SELECT id, status, admin_revision FROM users WHERE id = ?")
    .bind(id).first<{ id: string; status: string; admin_revision: number }>();
  if (!row) return replyError(404, "用户不存在");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  let update: D1PreparedStatement;
  let detail: Record<string, unknown> = {};
  if (action === "suspend" || action === "unsuspend") {
    if (!reason || reason.length > 500) return replyError(400, "请填写 1–500 字的操作理由");
    if (row.status === (action === "suspend" ? "suspended" : "active")) return replyError(409, "账号状态已改变，请刷新后重试");
    update = db.prepare("UPDATE users SET status = ?, status_reason = ?, status_changed_at = ?, token_version = token_version + 1, admin_revision = admin_revision + 1 WHERE id = ? AND admin_revision = ?")
      .bind(action === "suspend" ? "suspended" : "active", reason, Math.floor(Date.now() / 1000), id, row.admin_revision);
    detail = { status: action === "suspend" ? "suspended" : "active" };
  } else if (action === "revoke") {
    if (!reason || reason.length > 500) return replyError(400, "请填写 1–500 字的操作理由");
    update = db.prepare("UPDATE users SET token_version = token_version + 1, admin_revision = admin_revision + 1 WHERE id = ? AND admin_revision = ?")
      .bind(id, row.admin_revision);
  } else if (action === "metadata") {
    if (typeof input.note !== "string" || input.note.length > 1000 || typeof input.isTest !== "boolean") return replyError(400, "备注或测试账号标记无效");
    update = db.prepare("UPDATE users SET admin_note = ?, is_test = ?, admin_revision = admin_revision + 1 WHERE id = ? AND admin_revision = ?")
      .bind(input.note.trim(), input.isTest ? 1 : 0, id, row.admin_revision);
    detail = { isTest: input.isTest, noteChanged: true };
  } else return replyError(404, "未知的管理操作");
  const log = db.prepare(`INSERT INTO admin_audit_logs(id, actor_email, target_user_id, action, reason, details, request_id, created_at)
    SELECT ?, ?, id, ?, ?, ?, ?, ? FROM users WHERE id = ? AND admin_revision = ?`)
    .bind(crypto.randomUUID(), admin.email, action, reason || "更新内部备注和测试标记", JSON.stringify(detail),
      request.headers.get("cf-ray"), Math.floor(Date.now() / 1000), id, row.admin_revision + 1);
  const [change, logged] = await db.batch([update, log]);
  if (!change.meta.changes || !logged.meta.changes) return replyError(409, "用户资料已变化，请刷新后重试");
  return adminJson({ success: true });
}

export async function handleAdminRequest(request: Request, env: Env, admin: Admin): Promise<Response> {
  if (!env.DB) return replyError(503, "数据库暂时不可用");
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/u, "").split("/").filter(Boolean);
  if (!canManage(admin.role) && ["users", "audit-logs"].includes(path[0])) return replyError(403, "当前角色无权查看用户资料或操作日志");
  if (request.method === "GET") {
    if (path[0] === "me" && path.length === 1) return adminJson({ admin });
    if (path[0] === "overview" && path.length === 1) return overview(env.DB, url);
    if (path[0] === "users" && path.length === 1) return listUsers(env.DB, url, admin);
    if (path[0] === "users" && path.length === 2) return userDetail(env.DB, path[1], admin);
    if (path[0] === "audit-logs" && path.length === 1) {
      const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
      const rows = await env.DB.prepare("SELECT id, actor_email, target_user_id, action, reason, details, request_id, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 30 OFFSET ?")
        .bind((page - 1) * 30).all<{ id: string; actor_email: string; target_user_id: string; action: string; reason: string; details: string; request_id: string; created_at: number }>();
      return adminJson({ page, logs: rows.results.map((r) => ({ id: r.id, actorEmail: r.actor_email, targetUserId: r.target_user_id, action: r.action, reason: r.reason, details: JSON.parse(r.details), requestId: r.request_id, at: epochIso(r.created_at) })) });
    }
    if (path[0] === "resources" && path.length === 1) return getResources(env);
  }
  if (request.method === "POST" && path[0] === "users" && path.length === 3 && ["suspend", "unsuspend", "revoke", "metadata"].includes(path[2])) {
    return mutateUser(request, env.DB, path[1], path[2], admin);
  }
  return replyError(404, "管理接口不存在");
}
