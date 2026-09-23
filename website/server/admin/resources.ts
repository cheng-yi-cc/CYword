import { adminJson } from "./access.ts";

type Resource = { status: "ok" | "unavailable" | "not_configured"; source: string; window: string; updatedAt: string | null; metrics?: Record<string, number>; message?: string };

const DATABASE_ID = "6e6511c5-f46a-423d-90f8-689202578603";

const functionsQuery = `query Pages($accountTag: string!, $scriptName: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    pagesFunctionsInvocationsAdaptiveGroups(limit: 1, filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }) {
      sum { requests errors subrequests }
    }
  } }
}`;

async function queryAnalytics<T>(env: Env, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Cloudflare Analytics HTTP ${response.status}`);
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length || !payload.data) throw new Error(payload.errors?.[0]?.message ?? "Analytics data unavailable");
  return payload.data;
}

const d1Query = `query D1($accountTag: string!, $databaseId: string!, $start: Date!, $end: Date!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 31, filter: { databaseId: $databaseId, date_geq: $start, date_leq: $end }) {
      sum { readQueries writeQueries rowsRead rowsWritten }
    }
  } }
}`;

const r2Query = `query R2($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    downloadsStorage: r2StorageAdaptiveGroups(limit: 1, filter: { bucketName: "cyword-downloads", datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) {
      max { objectCount payloadSize metadataSize }
      dimensions { datetime }
    }
    booksStorage: r2StorageAdaptiveGroups(limit: 1, filter: { bucketName: "cyword-book-data", datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) {
      max { objectCount payloadSize metadataSize }
      dimensions { datetime }
    }
    downloadsOps: r2OperationsAdaptiveGroups(limit: 100, filter: { bucketName: "cyword-downloads", datetime_geq: $start, datetime_leq: $end }) {
      sum { requests }
      dimensions { actionType actionStatus }
    }
    booksOps: r2OperationsAdaptiveGroups(limit: 100, filter: { bucketName: "cyword-book-data", datetime_geq: $start, datetime_leq: $end }) {
      sum { requests }
      dimensions { actionType actionStatus }
    }
  } }
}`;

type D1Data = { viewer: { accounts: Array<{ d1AnalyticsAdaptiveGroups: Array<{ sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number } }> }> } };
type FunctionsData = { viewer: { accounts: Array<{ pagesFunctionsInvocationsAdaptiveGroups: Array<{ sum: { requests: number; errors: number; subrequests: number } }> }> } };
type R2Store = { max: { objectCount: number; payloadSize: number; metadataSize: number }; dimensions: { datetime: string } };
type R2Operation = { sum: { requests: number }; dimensions: { actionType: string; actionStatus: string } };
type R2Account = { downloadsStorage: R2Store[]; booksStorage: R2Store[]; downloadsOps: R2Operation[]; booksOps: R2Operation[] };
type R2Data = { viewer: { accounts: R2Account[] } };

function unavailable(source: string, window: string, message: string, configured: boolean): Resource {
  return { status: configured ? "unavailable" : "not_configured", source, window, updatedAt: null, message };
}

function bucketResource(storage: R2Store[] | undefined, operations: R2Operation[] | undefined, name: string): Resource {
  if (!storage?.[0]) return unavailable("Cloudflare R2 Analytics", "最近 24 小时", `${name} 尚无可用存储快照`, true);
  const values = storage[0].max;
  return { status: "ok", source: "Cloudflare R2 Analytics", window: "最近 24 小时", updatedAt: storage[0].dimensions.datetime,
    metrics: { objectCount: values.objectCount, storedBytes: values.payloadSize + values.metadataSize,
      operations: (operations ?? []).reduce((sum, item) => sum + item.sum.requests, 0),
      operationErrors: (operations ?? []).filter((item) => item.dimensions.actionStatus === "internalError")
        .reduce((sum, item) => sum + item.sum.requests, 0) } };
}

export async function getResources(env: Env): Promise<Response> {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const dateEnd = end.slice(0, 10);
  const dateStart = new Date(now.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
  const configured = Boolean(env.CF_ACCOUNT_ID && env.CF_PAGES_SCRIPT_NAME && env.CF_ANALYTICS_TOKEN);
  const resources: Record<string, Resource> = {
    functions: unavailable("Cloudflare Pages Analytics", "最近 24 小时", configured ? "暂时无法读取函数指标" : "需要只读 Analytics API Token 和账号 ID", configured),
    d1: unavailable("Cloudflare D1 Analytics", "今日与昨日（UTC，按日聚合）", configured ? "暂时无法读取 D1 指标" : "需要只读 Analytics API Token 和账号 ID", configured),
    downloads: unavailable("Cloudflare R2 Analytics", "最近 24 小时", configured ? "暂时无法读取安装包存储指标" : "需要只读 Analytics API Token 和账号 ID", configured),
    books: unavailable("Cloudflare R2 Analytics", "最近 24 小时", configured ? "暂时无法读取词书存储指标" : "需要只读 Analytics API Token 和账号 ID", configured),
    mail: unavailable("Resend", "最近 24 小时", "邮件投递统计尚未接入；登录事件不代表邮件送达", false),
  };
  if (!configured) return adminJson({ generatedAt: end, resources });
  const [functions, d1, r2] = await Promise.allSettled([
    queryAnalytics<FunctionsData>(env, functionsQuery, { accountTag: env.CF_ACCOUNT_ID, scriptName: env.CF_PAGES_SCRIPT_NAME, start, end }),
    queryAnalytics<D1Data>(env, d1Query, { accountTag: env.CF_ACCOUNT_ID, databaseId: DATABASE_ID, start: dateStart, end: dateEnd }),
    queryAnalytics<R2Data>(env, r2Query, { accountTag: env.CF_ACCOUNT_ID, start, end }),
  ]);
  if (functions.status === "fulfilled") {
    const row = functions.value.viewer.accounts[0]?.pagesFunctionsInvocationsAdaptiveGroups[0];
    resources.functions = row ? { status: "ok", source: "Cloudflare Pages Analytics", window: "最近 24 小时", updatedAt: null,
      metrics: { requests: row.sum.requests, executionErrors: row.sum.errors, subrequests: row.sum.subrequests } }
      : unavailable("Cloudflare Pages Analytics", "最近 24 小时", "当前时间范围内暂无函数调用指标", true);
  } else console.error("[CYWORD ADMIN] Pages Analytics:", functions.reason);
  if (d1.status === "fulfilled") {
    const account = d1.value.viewer.accounts[0];
    const rows = account?.d1AnalyticsAdaptiveGroups;
    if (rows?.length) {
      resources.d1 = { status: "ok", source: "Cloudflare D1 Analytics", window: "今日与昨日（UTC，按日聚合）", updatedAt: null,
        metrics: rows.reduce((acc, row) => ({ readQueries: acc.readQueries + row.sum.readQueries,
          writeQueries: acc.writeQueries + row.sum.writeQueries, rowsRead: acc.rowsRead + row.sum.rowsRead,
          rowsWritten: acc.rowsWritten + row.sum.rowsWritten }), { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 }) };
    } else resources.d1 = unavailable("Cloudflare D1 Analytics", "今日与昨日（UTC，按日聚合）", "当前时间范围内暂无 D1 指标", true);
  } else console.error("[CYWORD ADMIN] D1 Analytics:", d1.reason);
  if (r2.status === "fulfilled") {
    const account = r2.value.viewer.accounts[0];
    resources.downloads = bucketResource(account?.downloadsStorage, account?.downloadsOps, "安装包存储");
    resources.books = bucketResource(account?.booksStorage, account?.booksOps, "词书存储");
  } else console.error("[CYWORD ADMIN] R2 Analytics:", r2.reason);
  return adminJson({ generatedAt: end, resources });
}
