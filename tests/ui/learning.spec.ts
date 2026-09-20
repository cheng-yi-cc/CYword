import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const realCatalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const symposiumId = Object.keys(realCatalog.words).find(id => realCatalog.words[id].spelling === "symposium")!;
const symposium = JSON.parse(fs.readFileSync(`data/words/${symposiumId}.json`, "utf8"));
const ids = ["a", "b", "c", "d", "e"];
const details = Object.fromEntries(ids.map((id, i) => [id, { ...symposium, id, bookCode: "fixture", spelling: ["first", "symposium", "third", "fourth", "fifth"][i], pronunciationGuide: undefined, meaningBridges: undefined }]));
const catalog = {
  book: { code: "fixture", name: "测试词书", targetExam: "test", schemaVersion: 1 }, dataVersion: "fixture-v1",
  stats: { wordCount: 5, trueRootCount: 5, soloGroupCount: 0, studyGroupCount: 5, studyAppearanceCount: 5, scheduleDayCount: 3, targetPerDay: 3 },
  groups: ids.map((id, i) => ({ id: `group-${id}`, kind: "root", rootId: id, spelling: `root-${id}`, meaning: "测试词根", memoryMethod: "", wordIds: [id], wordCount: 1, firstOrder: i })),
  schedule: [
    { day: 1, groupIds: ["group-a", "group-b", "group-c"], appearanceCount: 3, uniqueWordCount: 3, segmentEnds: [1, 3] },
    { day: 2, groupIds: ["group-d"], appearanceCount: 1, uniqueWordCount: 1, segmentEnds: [1] },
    { day: 3, groupIds: ["group-e"], appearanceCount: 1, uniqueWordCount: 1, segmentEnds: [1] },
  ],
  words: Object.fromEntries(ids.map(id => [id, { id, spelling: details[id].spelling, pronunciation: details[id].pronunciation, definitionCn: details[id].definitionCn }])),
};
const empty = { version: 2, planDays: {}, words: {}, bookmarks: {}, reviewHistory: [] };

test("Android update menu retries and downloads only on request without changing progress", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, ["a"], false, true);
  const wordsBefore = await page.evaluate(() => (window as any).__test.local.words);
  await page.locator(".mobile-account summary").click();
  const menu = page.locator(".mobile-account .android-update-menu");
  await expect(menu).toContainText("当前版本 0.1.2");
  await expect(menu).toContainText("检查失败，请重试");
  await menu.getByRole("button", { name: "检查更新" }).click();
  await expect(menu).toContainText("已是最新版本");
  await page.evaluate(() => (window as any).__updateTest.notify({ status: "available", currentVersion: "0.1.2", release: { version: "0.1.3" } }));
  const notice = page.getByRole("complementary", { name: "发现应用更新" });
  await expect(notice).toContainText("新版本 0.1.3");
  expect(await page.evaluate(() => (window as any).__updateTest.downloads)).toBe(0);
  await notice.getByRole("button", { name: "稍后更新" }).click();
  await expect(notice).toBeHidden();
  await menu.getByRole("button", { name: "下载新版" }).click();
  await expect(menu).toContainText("已打开浏览器");
  expect(await page.evaluate(() => (window as any).__updateTest.downloads)).toBe(1);
  expect(await page.evaluate(() => (window as any).__test.local.words)).toEqual(wordsBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function setup(page: Page, learned: string[] = ["a"], sessionReadFails = false, androidUpdates = false) {
  await page.addInitScript(({ catalog, details, empty, learned, sessionReadFails, androidUpdates }) => {
    const initial = structuredClone(empty) as any;
    for (const id of learned) initial.words[id] = { learnedAt: "2026-09-19T00:00:00.000Z", lastSeenAt: "2026-09-19T00:00:00.000Z", proficiency: "unclear", exposures: 0, reviewCount: 0 };
    const state = { local: initial, remote: structuredClone(empty), revision: 0, writes: 0, wordRequests: [] as string[][], failLoads: false, failWrites: false, offline: false, writeGate: null as Promise<void> | null, releaseWrite: null as (() => void) | null, loadGate: null as Promise<void> | null, releaseLoad: null as (() => void) | null, clearFails: false, sessionCleared: false };
    (window as any).__test = state;
    window.cyword = {
      readCatalog: async () => structuredClone(catalog),
      readSession: async () => {
        if (sessionReadFails) throw new Error("受保护凭据解密失败");
        return state.sessionCleared ? null : ({ token: "fixture", user: { id: "fixture-user", email: "fixture@example.test", createdAt: 0, lastLoginAt: 0, loginCount: 1 } });
      },
      clearSession: async () => { if (state.clearFails) throw new Error("会话清理失败"); state.sessionCleared = true; return true; },
      readProgress: async () => structuredClone(state.local),
      writeProgress: async next => { state.writes++; if (state.writeGate) await state.writeGate; if (state.failWrites) throw new Error("磁盘写入失败"); state.local = structuredClone(next); return true; },
      syncProgress: async (_token, payload) => {
        if (state.offline) throw new Error("网络连接中断");
        if (payload) { state.remote = structuredClone(payload.progress); state.revision++; }
        return { status: 200, data: { revision: state.revision, progress: structuredClone(state.remote) } };
      },
      readWords: async request => {
        state.wordRequests.push(request.wordIds);
        const shouldFail = state.failLoads;
        if (state.loadGate) await state.loadGate;
        if (shouldFail) throw new Error("词书请求失败");
        return { dataVersion: catalog.dataVersion, wordCount: request.wordIds.length, words: Object.fromEntries(request.wordIds.map(id => [id, details[id]])) };
      },
    } as any;
    if (androidUpdates) {
      let snapshot: any = { status: "error", currentVersion: "0.1.2", message: "检查失败，请重试" };
      const listeners = new Set<() => void>();
      const notify = (next: any) => { snapshot=next; listeners.forEach(listener=>listener()); };
      (window as any).__updateTest = { downloads: 0, notify };
      window.cyword.androidUpdates = {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        check: async () => notify({ status: "current", currentVersion: "0.1.2" }),
        download: async () => { (window as any).__updateTest.downloads++; notify({ ...snapshot, message: "已打开浏览器，下载后点击 APK 安装" }); },
      };
    }
  }, { catalog, details, empty, learned, sessionReadFails, androidUpdates });
  await page.goto("/");
  if (sessionReadFails) {
    await expect(page.locator(".auth-message")).toContainText("读取受保护登录状态失败");
    return;
  }
  await expect(page.getByRole("button", { name: /继续今日学习|进入复习判断/ })).toBeVisible();
  await expect(page.locator(".sync-status")).toContainText("已与云端同步");
}

const study = (page: Page) => page.getByRole("dialog", { name: "今日单词学习" });
async function openStudy(page: Page) {
  await page.getByRole("button", { name: "继续今日学习" }).click();
  await expect(study(page)).toBeVisible();
  await expect(study(page).locator("h1")).toHaveText("symposium");
}

test("home reflects actual day after preview and opens the next word with correct morphology", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "词书计划", exact: true }).click();
  await page.getByTitle("查看 Day 3 学习内容").click();
  await expect(page.locator(".day-preview-banner")).toContainText("Day 3");
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.locator(".day-progress-count")).toContainText("1 / 3");
  await openStudy(page);
  await expect(study(page).locator(".study-word-equation b")).toHaveText(symposium.roots.toSorted((a: any, b: any) => a.order - b.order).map((part: any) => part.spelling));
  await expect(page.locator("#root")).toHaveAttribute("inert");
  await study(page).getByRole("button", { name: "返回", exact: false }).click();
  await expect(study(page)).toBeHidden();
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
});

test("failed and stale word requests stay local and retry succeeds", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__test.failLoads = true; });
  await page.getByRole("button", { name: "继续今日学习" }).click();
  await expect(study(page).locator(".study-center-scroll").getByText("单词详情加载失败")).toBeVisible();
  await expect(page.locator(".fatal-error")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__test.failLoads = false; });
  await study(page).locator(".study-center-scroll").getByRole("button", { name: "重新加载" }).click();
  await expect(study(page).locator("h1")).toHaveText("symposium");
  await study(page).getByRole("button", { name: "返回", exact: false }).click();
  await page.getByRole("button", { name: "词书计划", exact: true }).click();
  await page.getByTitle("查看 Day 3 学习内容").click();
  await page.evaluate(() => { const s = (window as any).__test; s.failLoads = true; s.loadGate = new Promise<void>(resolve => { s.releaseLoad = resolve; }); });
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(study(page).getByText("正在展开 fifth…")).toBeVisible();
  await study(page).getByRole("button", { name: "返回", exact: false }).click();
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.evaluate(() => { (window as any).__test.releaseLoad(); });
  await expect(page.getByRole("button", { name: "继续今日学习" })).toBeVisible();
  await expect(page.locator(".fatal-error")).toHaveCount(0);
});

test("a delayed rating locks all navigation and rates exactly one word", async ({ page }) => {
  await setup(page); await openStudy(page);
  await page.evaluate(() => { const s = (window as any).__test; s.writeGate = new Promise<void>(resolve => { s.releaseWrite = resolve; }); });
  await study(page).getByRole("button", { name: /1.*未掌握/ }).click();
  await expect(study(page).getByRole("button", { name: /上一个/ })).toBeDisabled();
  await expect(study(page).getByRole("button", { name: /返回/ })).toBeDisabled();
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Escape"); await page.keyboard.press("2");
  await page.evaluate(() => window.dispatchEvent(new Event("cyword-back", { cancelable: true })));
  await expect(study(page).locator("h1")).toHaveText("symposium");
  await page.evaluate(() => { const s = (window as any).__test; s.writeGate = null; s.releaseWrite(); });
  await expect(study(page).locator("h1")).toHaveText("third");
  expect(await page.evaluate(() => (window as any).__test.local.words.b.proficiency)).toBe("unmastered");
  expect(await page.evaluate(() => (window as any).__test.local.words.c)).toBeUndefined();
});

test("failed local write stays on the same word and is absent from later cloud sync", async ({ page }) => {
  await setup(page); await openStudy(page);
  await page.evaluate(() => { (window as any).__test.failWrites = true; });
  await study(page).getByRole("button", { name: /1.*未掌握/ }).click();
  await expect(study(page).getByRole("alert")).toContainText("未保存");
  await expect(study(page).locator("h1")).toHaveText("symposium");
  expect(await page.evaluate(() => (window as any).__test.local.words.b)).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__test.remote.words.b)).toBeUndefined();
  await page.evaluate(() => { (window as any).__test.failWrites = false; });
  await study(page).getByRole("button", { name: /1.*未掌握/ }).click();
  await expect(study(page).locator("h1")).toHaveText("third");
});

test("search rating and return retain the query without manufacturing a review", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "单词搜索", exact: true }).click();
  await page.getByRole("combobox", { name: "搜索单词" }).fill("sym");
  await page.getByRole("combobox", { name: "搜索单词" }).press("Enter");
  await page.locator(".search-result-list > button").click();
  const dialog = page.locator(".vocabulary-session");
  await expect(dialog.getByRole("button", { name: "下一个 ›" })).toBeDisabled();
  await dialog.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "搜索单词" })).toHaveValue("sym");
  expect(await page.evaluate(() => (window as any).__test.local.words.b.exposures)).toBe(0);
  expect(await page.evaluate(() => (window as any).__test.local.reviewHistory.length)).toBe(0);
});

test("offline logout explains local records and failed session removal leaves account open", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const s = (window as any).__test; s.offline = true; s.clearFails = true; });
  await page.locator(".btn-logout").click();
  const notice = page.getByRole("dialog", { name: "退出登录" });
  await expect(notice).toContainText("本机记录已保存");
  await notice.getByRole("button", { name: "继续退出" }).click();
  await expect(notice).toContainText("会话清理失败");
  expect(await page.evaluate(() => (window as any).__test.sessionCleared)).toBe(false);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 800, height: 600 }]) {
  test(`study controls and current word remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page); await openStudy(page);
    const dialog = study(page);
    await dialog.getByRole("button", { name: "词根", exact: true }).click();
    await expect(dialog.locator(".session-word-anchor")).toContainText("symposium");
    await expect(dialog.locator(".session-word-anchor").getByRole("button", { name: "播放发音" })).toBeVisible();
    const rate = await dialog.locator(".session-rating button.unmastered").boundingBox();
    expect(rate!.y).toBeGreaterThan(0); expect(rate!.y + rate!.height).toBeLessThanOrEqual(viewport.height);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(viewport.width);
    const scroll = await dialog.locator(".study-morpheme-column .study-column-scroll").boundingBox();
    expect(scroll!.height).toBeGreaterThan(100);
    await page.screenshot({ path: `.work/preflight/study-${viewport.width}x${viewport.height}.png` });
  });
}

test("a completed segment offers a pause without completing the day", async ({ page }) => {
  await setup(page, []);
  await page.getByRole("button", { name: "继续今日学习" }).click();
  await expect(study(page).locator("h1")).toHaveText("first");
  await study(page).locator(".session-rating button.unmastered").click();
  await expect(study(page).locator(".study-break-panel")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.local.planDays["1"].completedAt)).toBeUndefined();
  await study(page).getByRole("button", { name: "继续下一段" }).click();
  await expect(study(page).locator("h1")).toHaveText("symposium");
});

test("review reveals only on request and local word failure can be retried", async ({ page }) => {
  await setup(page, ids);
  await page.evaluate(() => { (window as any).__test.failLoads = true; });
  await page.getByRole("button", { name: "进入复习判断" }).click();
  await expect(page.locator(".judgment-front h2")).toHaveText("first");
  await expect(page.getByText("单词巧记", { exact: true })).toHaveCount(0);
  await page.locator(".judgment-front").click();
  await expect(page.locator(".judgment-card")).toContainText("单词详情加载失败");
  await page.evaluate(() => {
    const state = (window as any).__test;
    state.failLoads = false;
    const original = window.cyword.readWords;
    window.cyword.readWords = request => request.wordIds.includes("a") ? original(request) : new Promise(() => {});
  });
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".word-hero h2")).toHaveText("first");
  await page.locator(".proficiency-picker button.unmastered").click();
  await expect(page.locator(".judgment-front h2")).toHaveText("symposium");
  expect(await page.evaluate(() => (window as any).__test.local.reviewHistory.length)).toBe(1);
});

test("cached words survive page changes and native summary participates in modal focus order", async ({ page }) => {
  await setup(page); await openStudy(page);
  await study(page).getByRole("button", { name: /返回/ }).click();
  await page.getByRole("button", { name: "单词搜索", exact: true }).click();
  await page.getByRole("combobox", { name: "搜索单词" }).fill("sym");
  await page.getByRole("combobox", { name: "搜索单词" }).press("Enter");
  await page.locator(".search-result-list > button").click();
  const dialog = page.locator(".vocabulary-session");
  await expect(dialog.locator("h2")).toHaveText("symposium");
  const requests = await page.evaluate(() => (window as any).__test.wordRequests.filter((request: string[]) => request.includes("b")).length);
  expect(requests).toBe(1);
  const summary = dialog.locator(".morphology-node summary").first();
  await summary.focus(); await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "‹ 返回列表" })).not.toBeFocused();
});

test("an expired login during logout cannot leave a notice in the next account", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.cyword.syncProgress = async () => ({ status: 401, data: { error: "expired" } } as any);
    window.cyword.verifyAuthCode = async () => ({ success: true, token: "new-user", user: { id: "new-user", email: "new@example.test", createdAt: 0, lastLoginAt: 0, loginCount: 1 } });
    window.cyword.writeSession = async () => true;
  });
  await page.locator(".btn-logout").click();
  await expect(page.getByText("登录已过期，请重新登录。本机学习记录已保留。")).toBeVisible();
  await page.evaluate(() => { window.cyword.syncProgress = async () => ({ status: 200, data: { revision: 0, progress: (window as any).__test.local } }); });
  await page.getByLabel("电子邮箱").fill("new@example.test");
  await page.getByLabel("6 位验证码").fill("123456");
  await page.locator(".auth-submit-btn").click();
  await expect(page.getByRole("button", { name: "继续今日学习" })).toBeVisible();
  await expect(page.locator(".logout-notice")).toHaveCount(0);
});

test("credential restore failure is visible without clearing records and successful login clears the notice", async ({ page }) => {
  await setup(page, ["a"], true);
  await expect(page.locator(".auth-message")).toContainText("本机学习记录已保留，请重启应用重试或重新登录");
  expect(await page.evaluate(() => (window as any).__test.sessionCleared)).toBe(false);
  expect(await page.evaluate(() => (window as any).__test.local.words.a.proficiency)).toBe("unclear");
  expect(await page.evaluate(() => (window as any).__test.writes)).toBe(0);
  await page.evaluate(() => {
    window.cyword.verifyAuthCode = async () => ({ success: true, token: "restored", user: { id: "fixture-user", email: "fixture@example.test", createdAt: 0, lastLoginAt: 0, loginCount: 1 } });
    window.cyword.writeSession = async () => true;
  });
  await page.getByLabel("电子邮箱").fill("fixture@example.test");
  await page.getByLabel("6 位验证码").fill("123456");
  await page.locator(".auth-submit-btn").click();
  await expect(page.getByRole("button", { name: "继续今日学习" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.local.words.a.proficiency)).toBe("unclear");
  await page.locator(".btn-logout").click();
  await expect(page.getByLabel("电子邮箱")).toBeVisible();
  await expect(page.getByText("读取受保护登录状态失败", { exact: false })).toHaveCount(0);
});
