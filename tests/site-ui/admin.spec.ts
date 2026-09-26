import { test, expect } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`admin console loads real routes and account actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    let status = "active";
    await page.route("**/api/admin/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/admin/", "");
      const json = (body: object) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "me") return json({ admin: { email: "cyi907369@gmail.com", role: "owner" } });
      if (path === "overview") return json({ timezone: "Asia/Shanghai", generatedAt: "2026-09-23T08:00:00Z", counts: { total: 142, newToday: 3, new7d: 18, suspended: status === "suspended" ? 1 : 0, loginToday: 23, login7d: 67, loginEvents7d: 92 }, growth: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, count: i % 6 })), recentUsers: [{ id: "user-1", email: "s***@example.test", createdAt: "2026-09-23T07:00:00Z", status }], loginHistorySince: "后台启用后" });
      if (path === "users") return json({ users: [{ id: "user-1", email: "s***@example.test", createdAt: "2026-09-23T07:00:00Z", lastLoginAt: "2026-09-23T07:30:00Z", loginCount: 4, status, isTest: false }], total: 1, page: 1, size: 20 });
      if (path === "users/user-1" && route.request().method() === "GET") return json({ user: { id: "user-1", email: "student@example.test", createdAt: "2026-09-23T07:00:00Z", lastLoginAt: "2026-09-23T07:30:00Z", loginCount: 4, status, statusReason: status === "suspended" ? "异常请求" : null, statusChangedAt: null, isTest: false, adminNote: "" }, cloudProgress: [], events: [], audit: [] });
      if (path === "users/user-1/suspend") { status = "suspended"; return json({ success: true }); }
      if (path === "resources") return json({ generatedAt: "2026-09-23T08:00:00Z", resources: Object.fromEntries(["functions", "d1", "downloads", "books", "mail"].map((key) => [key, { status: "not_configured", source: "Cloudflare", window: "最近24小时", updatedAt: null, message: "尚未接入" }])) });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
    });
    await page.goto("/admin/");
    await expect(page.getByRole("heading", { name: "数据总览" })).toBeVisible();
    await expect(page.getByText("142", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
    await page.getByRole("navigation", { name: "后台导航" }).filter({ visible: true }).getByRole("link", { name: "用户管理" }).click();
    await expect(page.getByText("s***@example.test")).toBeVisible();
    await page.getByRole("button", { name: "查看 →" }).click();
    await expect(page.getByRole("heading", { name: "student@example.test" })).toBeVisible();
    await page.getByRole("button", { name: "封禁账号" }).first().click();
    await page.getByPlaceholder("必填，写入操作日志").fill("异常请求");
    await page.getByRole("dialog").getByRole("button", { name: "封禁账号" }).click();
    await expect(page.getByText("已封禁", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
