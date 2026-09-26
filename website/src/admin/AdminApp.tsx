import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type Admin = { email: string; role: "owner" | "operator" | "viewer" };
type User = { id: string; email: string; createdAt: string; lastLoginAt: string; loginCount: number; status: string; statusReason: string | null; statusChangedAt: string | null; isTest: boolean; adminNote?: string };
type Overview = { timezone: string; generatedAt: string; counts: { total: number; newToday: number; new7d: number; suspended: number; loginToday: number; login7d: number; loginEvents7d: number }; growth: Array<{ day: string; count: number }>; recentUsers: Array<Pick<User, "id" | "email" | "createdAt" | "status">>; loginHistorySince: string };
type Detail = { user: User; cloudProgress: Array<{ bookCode: string; revision: number; updatedAt: string; bytes: number }>; events: Array<{ kind: string; at: string }>; audit: Array<{ actorEmail: string; action: string; reason: string; at: string }> };
type Resource = { status: "ok" | "unavailable" | "not_configured"; source: string; window: string; updatedAt: string | null; metrics?: Record<string, number>; message?: string };
type ResourceData = { generatedAt: string; resources: Record<string, Resource> };
type Audit = { id: string; actorEmail: string; targetUserId: string | null; action: string; reason: string; at: string };

const fmt = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const dateTime = (value: string | null | undefined) => value ? fmt.format(new Date(value)) : "—";
const count = (value: number | undefined) => value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
const roleName = { owner: "Owner", operator: "Operator", viewer: "Viewer" };
const actionName: Record<string, string> = { suspend: "封禁账号", unsuspend: "解除封禁", revoke: "撤销登录凭证", metadata: "更新用户资料" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

function useRemote<T>(path: string | null, reload = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) return;
    let active = true;
    setData(null); setLoading(true); setError("");
    api<T>(path).then((result) => { if (active) setData(result); }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, reload]);
  return { data, error, loading };
}

function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
function ErrorLine({ message, retry }: { message: string; retry?: () => void }) { return <div className="error-line" role="alert"><span>{message}</span>{retry && <button type="button" onClick={retry}>重试</button>}</div>; }
function Status({ value }: { value: string }) { return <span className={`status ${value === "active" ? "status-ok" : "status-warn"}`}>{value === "active" ? "正常" : "已封禁"}</span>; }

function OverviewPage({ navigate }: { navigate: (to: string) => void }) {
  const [reload, setReload] = useState(0);
  const [includeTest, setIncludeTest] = useState(false);
  const { data, error, loading } = useRemote<Overview>(`overview?includeTest=${includeTest ? 1 : 0}`, reload);
  const max = Math.max(1, ...(data?.growth.map((item) => item.count) ?? [1]));
  return <>
    <div className="page-heading"><div><p className="eyebrow">运营概览 · Asia/Shanghai</p><h1>数据总览</h1></div><div className="heading-actions"><label className="check"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />包含测试账号</label><button className="ghost-button" onClick={() => setReload((x) => x + 1)}>刷新数据</button></div></div>
    {error && <ErrorLine message={error} retry={() => setReload((x) => x + 1)} />}
    {loading && !data ? <Empty>正在读取运营数据…</Empty> : data && <>
      <div className="metrics-grid">
        <Metric label="注册账号" value={count(data.counts.total)} note={includeTest ? "包含测试账号" : "已排除测试账号"} />
        <Metric label="今日新增" value={count(data.counts.newToday)} note="首次注册成功" />
        <Metric label="近 7 日新增" value={count(data.counts.new7d)} note="含今日" />
        <Metric label="今日登录用户" value={count(data.counts.loginToday)} note="成功登录去重 · 非学习日活" />
      </div>
      <div className="overview-grid">
        <section className="surface growth-card"><div className="surface-title"><div><p className="eyebrow">近 30 天</p><h2>注册增长</h2></div><span className="subtle">每日新增账号</span></div><div className="bar-chart" role="img" aria-label="近30天每日新增账号柱状图">{data.growth.map((item, index) => <button key={item.day} type="button" title={`${item.day} · 新增 ${item.count} 人`} className="bar-item" onClick={() => navigate(`/admin/users?from=${item.day}&to=${item.day}`)}><span className="bar-value">{item.count || ""}</span><span className="bar" style={{ height: `${Math.max(item.count ? 10 : 3, item.count / max * 100)}%` }} /><span className="bar-label">{index % 5 === 0 || index === 29 ? item.day.slice(5) : ""}</span></button>)}</div></section>
        <section className="surface pulse-card"><div className="surface-title"><div><p className="eyebrow">账号状态</p><h2>需要关注</h2></div></div><div className="pulse-row"><span>已封禁账号</span><strong>{count(data.counts.suspended)}</strong></div><div className="pulse-row"><span>近 7 日登录用户</span><strong>{count(data.counts.login7d)}</strong></div><div className="pulse-row"><span>近 7 日登录次数</span><strong>{count(data.counts.loginEvents7d)}</strong></div><p className="context-note">登录事件从管理后台启用后开始记录。离线学习不会计入这些数字。</p></section>
      </div>
      <section className="surface recent-card"><div className="surface-title"><div><p className="eyebrow">最近加入</p><h2>新注册用户</h2></div><button className="text-button" onClick={() => navigate("/admin/users")}>查看全部 →</button></div>{data.recentUsers.length ? <div className="recent-list">{data.recentUsers.map((user) => <button type="button" key={user.id} className="recent-row" onClick={() => navigate(`/admin/users/${user.id}`)}><span className="email">{user.email}</span><span>{dateTime(user.createdAt)}</span><Status value={user.status} /><span aria-hidden="true">↗</span></button>)}</div> : <Empty>还没有注册账号。</Empty>}</section>
      <p className="updated">数据更新：{dateTime(data.generatedAt)} · 统计时区 Asia/Shanghai</p>
    </>}
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }

function UsersPage({ location, navigate }: { location: { pathname: string; search: string }; navigate: (to: string) => void }) {
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [search, setSearch] = useState(params.get("search") ?? "");
  useEffect(() => setSearch(params.get("search") ?? ""), [params]);
  const [reload, setReload] = useState(0);
  const { data, error, loading } = useRemote<{ users: User[]; total: number; page: number; size: number }>(`users?${params.toString()}`, reload);
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); navigate(`/admin/users?${next.toString()}`); };
  const submit = (event: FormEvent) => { event.preventDefault(); change("search", search.trim()); };
  return <>
    <div className="page-heading"><div><p className="eyebrow">账号与访问权限</p><h1>用户管理</h1></div><button className="ghost-button" onClick={() => setReload((x) => x + 1)}>刷新列表</button></div>
    <section className="surface users-panel"><div className="filter-row"><form onSubmit={submit} className="search-form"><input aria-label="搜索邮箱或用户 ID" placeholder="搜索邮箱或用户 ID" value={search} onChange={(e) => setSearch(e.target.value)} /><button type="submit">搜索</button></form><select aria-label="账号状态" value={params.get("status") ?? "all"} onChange={(e) => change("status", e.target.value)}><option value="all">全部状态</option><option value="active">正常</option><option value="suspended">已封禁</option></select><select aria-label="排序方式" value={params.get("sort") ?? "created"} onChange={(e) => change("sort", e.target.value)}><option value="created">最近注册</option><option value="login">最近登录</option><option value="frequency">登录次数</option></select><label className="check"><input type="checkbox" checked={params.get("includeTest") === "1"} onChange={(e) => change("includeTest", e.target.checked ? "1" : "")} />包含测试账号</label></div>
      <div className="date-row"><span>注册时间</span><input aria-label="起始日期" type="date" value={params.get("from") ?? ""} onChange={(e) => change("from", e.target.value)} /><span>至</span><input aria-label="结束日期" type="date" value={params.get("to") ?? ""} onChange={(e) => change("to", e.target.value)} />{(params.has("from") || params.has("to")) && <button className="text-button" onClick={() => { const next = new URLSearchParams(params); next.delete("from"); next.delete("to"); navigate(`/admin/users?${next.toString()}`); }}>清除日期</button>}</div>
      {error && <ErrorLine message={error} retry={() => setReload((x) => x + 1)} />}
      <div className="table-scroll"><table><thead><tr><th>用户</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>登录次数</th><th></th></tr></thead><tbody>{data?.users.map((user) => <tr key={user.id} onClick={() => navigate(`/admin/users/${user.id}${location.search}`)}><td><strong>{user.email}</strong><small>{user.id.slice(0, 8)}{user.isTest && " · 测试账号"}</small></td><td><Status value={user.status} /></td><td>{dateTime(user.createdAt)}</td><td>{dateTime(user.lastLoginAt)}</td><td>{count(user.loginCount)}</td><td><button className="text-button" onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${user.id}${location.search}`); }}>查看 →</button></td></tr>)}</tbody></table>{loading && !data && <Empty>正在读取用户列表…</Empty>}{!loading && data?.users.length === 0 && <Empty>没有符合条件的用户。</Empty>}</div>
      {data && <div className="table-footer"><span>共 {count(data.total)} 个账号</span><div><button className="ghost-button" disabled={data.page <= 1} onClick={() => change("page", String(data.page - 1))}>上一页</button><span>第 {data.page} 页</span><button className="ghost-button" disabled={data.page * data.size >= data.total} onClick={() => change("page", String(data.page + 1))}>下一页</button></div><select aria-label="每页数量" value={data.size} onChange={(e) => change("size", e.target.value)}><option value="20">20 / 页</option><option value="50">50 / 页</option><option value="100">100 / 页</option></select></div>}
    </section>
  </>;
}

function UserDetailPage({ id, admin, location, navigate }: { id: string; admin: Admin; location: { search: string }; navigate: (to: string) => void }) {
  const [reload, setReload] = useState(0);
  const { data, error, loading } = useRemote<Detail>(`users/${encodeURIComponent(id)}`, reload);
  const [action, setAction] = useState<"suspend" | "unsuspend" | "revoke" | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (data) { setNote(data.user.adminNote ?? ""); setIsTest(data.user.isTest); } }, [data]);
  const mutate = async (name: string, body: object) => { setSaving(true); setMessage(""); try { await api(`users/${encodeURIComponent(id)}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setAction(null); setReason(""); setMessage("已保存"); setReload((x) => x + 1); } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); } };
  const canEdit = admin.role !== "viewer";
  return <>
    <div className="page-heading"><div><button className="back-button" onClick={() => navigate(`/admin/users${location.search}`)}>← 返回用户列表</button><h1>用户详情</h1></div><button className="ghost-button" onClick={() => setReload((x) => x + 1)}>刷新</button></div>
    {error && <ErrorLine message={error} retry={() => setReload((x) => x + 1)} />}{loading && !data && <Empty>正在读取用户资料…</Empty>}
    {data && <div className="detail-grid"><section className="surface detail-main"><div className="surface-title"><div><p className="eyebrow">账号信息</p><h2>{data.user.email}</h2></div><Status value={data.user.status} /></div><div className="facts"><div><span>用户 ID</span><strong className="monospace">{data.user.id}</strong></div><div><span>注册时间</span><strong>{dateTime(data.user.createdAt)}</strong></div><div><span>最近登录</span><strong>{dateTime(data.user.lastLoginAt)}</strong></div><div><span>成功登录次数</span><strong>{count(data.user.loginCount)}</strong></div><div><span>测试账号</span><strong>{data.user.isTest ? "是" : "否"}</strong></div>{data.user.statusReason && <div><span>状态原因</span><strong>{data.user.statusReason}</strong></div>}</div>
      {canEdit && <><div className="section-divider" /><h3>内部资料</h3><label className="field-label">管理员备注<textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="仅管理员可见" /></label><label className="check"><input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />标记为测试账号</label><button className="primary-button" disabled={saving} onClick={() => mutate("metadata", { note, isTest })}>保存资料</button></>}
    </section><div className="detail-side"><section className="surface"><p className="eyebrow">云端访问</p><h2>账号操作</h2><p className="context-note">限制后续云端访问，不会远程删除设备上的词书或学习记录。</p>{canEdit ? <div className="action-stack">{data.user.status === "active" ? <button className="danger-button" onClick={() => setAction("suspend")}>封禁账号</button> : <button className="ghost-button" onClick={() => setAction("unsuspend")}>解除封禁</button>}<button className="ghost-button" onClick={() => setAction("revoke")}>撤销已有登录凭证</button></div> : <p className="subtle">当前角色为只读。</p>}</section><section className="surface"><p className="eyebrow">历史云端数据</p><h2>旧进度记录</h2>{data.cloudProgress.length ? data.cloudProgress.map((p) => <div className="record-row" key={p.bookCode}><strong>{p.bookCode}</strong><span>{dateTime(p.updatedAt)} · {count(p.bytes)} 字节</span></div>) : <p className="context-note">未发现旧云端进度。当前学习进度保存在用户设备上。</p>}</section></div><section className="surface detail-history"><p className="eyebrow">近期记录</p><h2>登录与管理操作</h2>{!data.events.length && !data.audit.length ? <Empty>启用后台后暂无记录。</Empty> : <div className="history-list">{[...data.events.map((e) => ({ at: e.at, title: "成功登录", description: "账号通过邮箱验证码登录" })), ...data.audit.map((a) => ({ at: a.at, title: actionName[a.action] ?? a.action, description: `${a.actorEmail} · ${a.reason}` }))].sort((a, b) => b.at.localeCompare(a.at)).map((item, i) => <div className="history-row" key={i}><span>{dateTime(item.at)}</span><strong>{item.title}</strong><small>{item.description}</small></div>)}</div>}</section></div>}
    {message && <div className="toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="关闭提示">×</button></div>}
    {action && <div className="modal-backdrop" role="presentation" onMouseDown={() => setAction(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="action-title" onMouseDown={(e) => e.stopPropagation()}><p className="eyebrow">请确认操作</p><h2 id="action-title">{actionName[action]}</h2><p>{action === "suspend" ? "此账号将无法继续登录或访问受保护的云端接口。" : action === "unsuspend" ? "账号将恢复云端访问，但旧凭证仍需重新登录。" : "所有现有云端登录凭证会失效，离线设备不会立即退出。"}</p><label className="field-label">操作理由<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} autoFocus placeholder="必填，写入操作日志" /></label><div className="modal-actions"><button className="ghost-button" onClick={() => setAction(null)}>取消</button><button className={action === "suspend" ? "danger-button" : "primary-button"} disabled={saving || !reason.trim()} onClick={() => mutate(action, { reason })}>{saving ? "处理中…" : actionName[action]}</button></div></div></div>}
  </>;
}

function ResourcesPage() {
  const [reload, setReload] = useState(0);
  const { data, error, loading } = useRemote<ResourceData>("resources", reload);
  const cards = [{ key: "functions", title: "Pages Functions", subtitle: "接口执行" }, { key: "d1", title: "D1 数据库", subtitle: "cyword-db" }, { key: "downloads", title: "安装包存储", subtitle: "cyword-downloads" }, { key: "books", title: "词书存储", subtitle: "cyword-book-data" }, { key: "mail", title: "邮件服务", subtitle: "Resend" }];
  const names: Record<string, string> = { requests: "函数请求", executionErrors: "执行异常", subrequests: "子请求", readQueries: "读取查询", writeQueries: "写入查询", rowsRead: "扫描行数", rowsWritten: "写入行数", objectCount: "对象数量", storedBytes: "存储体积", operations: "操作次数", operationErrors: "内部错误" };
  return <><div className="page-heading"><div><p className="eyebrow">Cloudflare · 平台统计</p><h1>资源监控</h1></div><button className="ghost-button" onClick={() => setReload((x) => x + 1)}>刷新指标</button></div><p className="page-intro">此项目运行在 Cloudflare Pages、D1 和 R2 上。指标按平台数据源显示；未接入或暂不可用时不会填入估算值。</p>{error && <ErrorLine message={error} retry={() => setReload((x) => x + 1)} />}{loading && !data && <Empty>正在读取云端指标…</Empty>}{data && <div className="resource-grid">{cards.map((card) => { const resource = data.resources[card.key]; return <section className="surface resource-card" key={card.key}><div className="resource-top"><div><p className="eyebrow">{card.subtitle}</p><h2>{card.title}</h2></div><span className={`resource-status ${resource?.status === "ok" ? "ready" : "idle"}`}>{resource?.status === "ok" ? "已连接" : resource?.status === "not_configured" ? "未接入" : "暂不可用"}</span></div>{resource?.metrics ? <div className="resource-metrics">{Object.entries(resource.metrics).map(([key, value]) => <div key={key}><span>{names[key] ?? key}</span><strong>{key === "storedBytes" ? `${(value / 1024 / 1024).toFixed(1)} MB` : count(value)}</strong></div>)}</div> : <p className="resource-message">{resource?.message ?? "暂无数据"}</p>}<div className="resource-foot"><span>{resource?.source}</span><span>{resource?.updatedAt ? dateTime(resource.updatedAt) : resource?.window}</span></div></section>; })}</div>}<p className="context-note resource-note">R2 操作次数不是软件下载人数；函数执行状态也不能直接代表 HTTP 请求是否成功。</p></>;
}

function AuditPage({ navigate }: { navigate: (to: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useRemote<{ page: number; logs: Audit[] }>(`audit-logs?page=${page}`);
  return <><div className="page-heading"><div><p className="eyebrow">不可从后台删除</p><h1>操作日志</h1></div></div>{error && <ErrorLine message={error} />}{loading && !data && <Empty>正在读取操作日志…</Empty>}{data && <section className="surface audit-panel">{data.logs.length ? data.logs.map((log) => <div className="audit-row" key={log.id}><span className="audit-time">{dateTime(log.at)}</span><span className="audit-action">{actionName[log.action] ?? log.action}</span><span className="audit-actor">{log.actorEmail}</span><span>{log.reason}</span>{log.targetUserId && <button className="text-button" onClick={() => navigate(`/admin/users/${log.targetUserId}`)}>查看用户 →</button>}</div>) : <Empty>暂无管理操作记录。</Empty>}<div className="table-footer"><button className="ghost-button" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>上一页</button><span>第 {page} 页</span><button className="ghost-button" disabled={data.logs.length < 30} onClick={() => setPage((x) => x + 1)}>下一页</button></div></section>}</>;
}

export default function AdminApp() {
  const [location, setLocation] = useState({ pathname: window.location.pathname, search: window.location.search });
  const navigate = useCallback((to: string) => { window.history.pushState(null, "", to); setLocation({ pathname: window.location.pathname, search: window.location.search }); window.scrollTo({ top: 0 }); }, []);
  useEffect(() => { const back = () => setLocation({ pathname: window.location.pathname, search: window.location.search }); window.addEventListener("popstate", back); return () => window.removeEventListener("popstate", back); }, []);
  const [reload, setReload] = useState(0);
  const { data: identity, error, loading } = useRemote<{ admin: Admin }>("me", reload);
  if (loading && !identity) return <div className="gate"><span className="gate-brand">CYword</span><p>正在验证管理员身份…</p></div>;
  if (error || !identity) return <div className="gate"><span className="gate-brand">CYword</span><h1>无法进入管理后台</h1><p>{error || "管理员身份验证失败"}</p><button className="primary-button" onClick={() => setReload((x) => x + 1)}>重新验证</button></div>;
  const admin = identity.admin;
  const active = location.pathname.split("/")[2] || "overview";
  const links = [{ key: "overview", label: "数据总览", path: "/admin/" }, { key: "users", label: "用户管理", path: "/admin/users" }, { key: "resources", label: "资源监控", path: "/admin/resources" }, { key: "audit-logs", label: "操作日志", path: "/admin/audit-logs" }].filter((link) => admin.role !== "viewer" || ["overview", "resources"].includes(link.key));
  const navigateLink = (path: string) => (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); navigate(path); };
  return <div className="admin-shell"><a className="skip-link" href="#main">跳到主要内容</a><aside className="sidebar"><div className="sidebar-brand"><span className="brand-symbol">C</span><div><strong>CYword</strong><small>管理控制台</small></div></div><nav aria-label="后台导航">{links.map((link) => <a key={link.key} href={link.path} onClick={navigateLink(link.path)} className={active === link.key ? "active" : ""}>{link.label}<span>↗</span></a>)}</nav><div className="sidebar-bottom"><span className="environment"><i />生产环境</span><strong>{admin.email}</strong><small>{roleName[admin.role]}</small><a href="/cdn-cgi/access/logout">退出登录</a></div></aside><div className="main-column"><header className="topbar"><span className="topbar-caption">CYword / 管理控制台</span><span>{admin.email} <i>·</i> {roleName[admin.role]}</span></header><nav className="mobile-nav" aria-label="后台导航">{links.map((link) => <a key={link.key} href={link.path} onClick={navigateLink(link.path)} className={active === link.key ? "active" : ""}>{link.label}</a>)}</nav><main id="main" className="main-content">{active === "overview" ? <OverviewPage navigate={navigate} /> : active === "users" && location.pathname.split("/")[3] ? <UserDetailPage key={location.pathname.split("/")[3]} id={location.pathname.split("/")[3]} admin={admin} location={location} navigate={navigate} /> : active === "users" ? <UsersPage location={location} navigate={navigate} /> : active === "resources" ? <ResourcesPage /> : active === "audit-logs" ? <AuditPage navigate={navigate} /> : <Empty>页面不存在。<button className="text-button" onClick={() => navigate("/admin/")}>返回总览</button></Empty>}</main></div></div>;
}
