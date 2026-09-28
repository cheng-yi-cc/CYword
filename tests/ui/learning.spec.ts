import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { installSyncPreview } from '../install-sync-preview.mjs';

const realCatalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const symposiumId = Object.keys(realCatalog.words).find(id => realCatalog.words[id].spelling === "symposium")!;
const symposium = JSON.parse(fs.readFileSync(`data/words/${symposiumId}.json`, "utf8"));
const ids = ["a", "b", "c", "d", "e"];
const details = Object.fromEntries(ids.map((id, i) => [id, { ...symposium, id, bookCode: "fixture", spelling: ["first", "symposium", "third", "fourth", "fifth"][i], pronunciationGuide: id === "b" ? symposium.pronunciationGuide : undefined, meaningBridges: undefined }]));
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
// A real one-second WAV exercises blob playback without calling the audio CDN.
const wav = Buffer.alloc(16044);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
const audioBase64 = wav.toString("base64");

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

async function setup(page: Page, learned: string[] = ["a"], sessionReadFails = false, androidUpdates = false, downloadBatchLimit = 64) {

  await page.addInitScript(({ catalog, details, empty, learned, sessionReadFails, androidUpdates, audioBase64, downloadBatchLimit }) => {
    const initial = structuredClone(empty) as any;
    for (const id of learned) initial.words[id] = { learnedAt: "2026-09-19T00:00:00.000Z", lastSeenAt: "2026-09-19T00:00:00.000Z", proficiency: "unclear", exposures: 0, reviewCount: 0 };
    const state = { local: JSON.parse(localStorage.getItem("test-progress") || "null") || initial, remote: structuredClone(empty), revision: 0, writes: 0, cloudReads: 0, cloudWrites: 0, audioRequests: 0, wordRequests: [] as string[][], failLoads: false, failWrites: false, offline: false, writeGate: null as Promise<void> | null, releaseWrite: null as (() => void) | null, loadGate: null as Promise<void> | null, releaseLoad: null as (() => void) | null, clearFails: false, sessionCleared: false };
    (window as any).__test = state;
    window.cyword = {
      readCatalog: async () => structuredClone(catalog),
      readSession: async () => {
        if (sessionReadFails) throw new Error("受保护凭据解密失败");
        return state.sessionCleared ? null : ({ token: "fixture", user: { id: "fixture-user", email: "fixture@example.test", createdAt: 0, lastLoginAt: 0, loginCount: 1 } });
      },
      clearSession: async () => { if (state.clearFails) throw new Error("会话清理失败"); state.sessionCleared = true; return true; },
      readProgress: async () => structuredClone(state.local),
      downloadBookAudio: async () => { state.audioRequests++; return { base64: audioBase64, contentType: "audio/wav" }; },
      writeProgress: async next => { state.writes++; if (state.writeGate) await state.writeGate; if (state.failWrites) throw new Error("磁盘写入失败"); state.local = structuredClone(next); localStorage.setItem("test-progress", JSON.stringify(next)); return true; },
      progressRequest: async (_token, operation) => {
        if (operation.action === 'commit') state.cloudWrites++; else if (operation.action === 'read') state.cloudReads++;
        if (state.offline) throw new Error("网络连接中断");
        (state as any).request ??= (window as any).IncrementalMock.createProgressPreview(catalog, state);
        return (state as any).request(operation);
      },
      readWords: async request => {
        state.wordRequests.push(request.wordIds);
        const shouldFail = state.failLoads;
        if (state.loadGate) await state.loadGate;
        if (shouldFail) throw new Error("词书请求失败");
        if (request.wordIds.length > downloadBatchLimit) return { dataVersion: catalog.dataVersion, wordCount: request.wordIds.length, words: {} };
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
  }, { catalog, details, empty, learned, sessionReadFails, androidUpdates, audioBase64, downloadBatchLimit });
  await page.route("**/__local-book/catalog", route => route.fulfill({ json: catalog }));
  await page.route("**/__local-book/words", async route => {
    try { await route.fulfill({ json: await page.evaluate(request => window.cyword.readWords(request), route.request().postDataJSON()) }); }
    catch { await route.fulfill({ status: 503, body: "读取失败" }); }
  });
  await page.route("**/__local-book/media?*", async route => {
    await page.evaluate(() => { (window as any).__test.audioRequests++; });
    await route.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "继续学习" })).toBeVisible();
  // Inject read faults at the local repository boundary, not the retired network path.
  await page.evaluate(async () => {
    const { offlineBook } = await import("/src/offline-book.ts");
    (window as any).__offlineBook = offlineBook;
    const original = offlineBook.readWords.bind(offlineBook);
    offlineBook.readWords = async (request: any) => {
      const state = (window as any).__test, failed = state.failLoads;
      if (state.loadGate) await state.loadGate;
      if (failed) throw new Error("本地词条读取失败");
      return original(request);
    };
  });
}

const study = (page: Page) => page.getByRole("dialog", { name: "今日单词学习" });

test("render boundary keeps saved progress and can recover a failed subtree", async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => JSON.stringify((window as any).__test.local));
  await page.evaluate(async () => {
    const harness = await import("/tests/ui/error-boundary-harness.tsx");
    (window as any).__boundary = harness.mountBoundaryFixture();
  });
  const fallback = page.locator("#boundary-fixture");
  await expect(fallback).toContainText("这部分内容暂时无法显示");
  await page.evaluate(() => (window as any).__boundary.repair());
  await fallback.getByRole("button", { name: "重试" }).click();
  await expect(fallback).toHaveText("内容已恢复");
  expect(await page.evaluate(() => JSON.stringify((window as any).__test.local))).toBe(before);
  await page.evaluate(() => (window as any).__boundary.close());
});
async function openStudy(page: Page) {
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(study(page)).toBeVisible();
  await expect(study(page).locator("h1")).toHaveText("symposium");
}

for (const width of [1280, 390]) {
  test(`pronunciation segmentation restores manual state at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page); await openStudy(page);
    await page.evaluate(() => {
      // 控制音频生命周期，验证结束、失败和停止，不依赖设备播放时长。
      window.Audio = class extends EventTarget {
        constructor() { super(); (window as any).__audio = this; }
        play() { (window as any).__playingAudio = this; return Promise.resolve(); }
        pause() { if ((window as any).__playingAudio === this) (window as any).__playingAudio = undefined; }
      } as any;
    });
    const finishAudio = async (type: "ended" | "error") => {
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__playingAudio))).toBe(true);
      await page.evaluate(event => (window as any).__playingAudio.dispatchEvent(new Event(event)), type);
    };
    const spelling = study(page).locator("h1 .sound-spelling");
    const audio = study(page).locator(".study-word-hero .audio-button");
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await spelling.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await spelling.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await audio.locator("strong").click();
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await finishAudio("ended");
    await expect(spelling).toHaveAttribute("aria-pressed", "false");

    await spelling.focus(); await page.keyboard.press("Enter");
    await audio.click();
    await finishAudio("ended");
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await spelling.click();
    await audio.click(); await audio.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await audio.click();
    await finishAudio("error");
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await expect(audio).toHaveAttribute("aria-label", "重试发音");
    await audio.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await finishAudio("ended");

    await spelling.click();
    await page.screenshot({ path: `.work/preflight/segmentation-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await study(page).locator(".session-rating button.unmastered").click();
    await expect(study(page).locator("h1")).toHaveText("third");
    await study(page).getByRole("button", { name: /上一个/ }).click();
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
  });
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
  await page.getByRole("button", { name: "继续学习" }).click();
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
  await expect(page.getByRole("button", { name: "继续学习" })).toBeVisible();
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

test("failed local write stays on the same word and succeeds after retry", async ({ page }) => {
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
  const spelling = dialog.locator("h2 .sound-spelling");
  await expect(spelling).toHaveAttribute("aria-pressed", "false");
  await spelling.click();
  await expect(spelling).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "下一个 ›" })).toBeDisabled();
  await dialog.getByRole("button", { name: "已掌握", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "搜索单词" })).toHaveValue("sym");
  expect(await page.evaluate(() => (window as any).__test.local.words.b.exposures)).toBe(0);
  expect(await page.evaluate(() => (window as any).__test.local.reviewHistory.length)).toBe(0);
});

test("titlebar search shortcut, book menu and release history replace the old sidebar entry", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "单词搜索" })).toHaveCount(0);
  await page.locator(".book-picker summary").click();
  await expect(page.locator(".book-picker .current")).toContainText("当前使用");
  await expect(page.locator(".book-choice").getByText("即将上线")).toBeVisible();
  await expect(page.locator("button.book-choice")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "单词搜索", exact: true });
  await expect(search.getByRole("combobox")).toBeFocused();
  await search.getByRole("combobox").fill("sym");
  await search.getByRole("combobox").press("ArrowDown");
  await search.getByRole("combobox").press("Enter");
  await expect(page.locator(".vocabulary-session")).toBeVisible();
  await expect(search).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(search.getByRole("combobox")).toHaveValue("sym");
  await expect(search).not.toHaveAttribute("inert");
  await page.screenshot({ path: ".work/preflight/titlebar-search.png" });
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await page.locator(".release-notes-entry").click();
  const releases = page.getByRole("dialog", { name: "更新日志" });
  await expect(releases.locator(".release-detail")).toContainText("Windows 0.1.0");
  await expect(releases.locator(".release-detail")).toContainText("无需注册或登录");
  await page.screenshot({ path: ".work/preflight/release-history.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".release-notes-entry")).toBeFocused();
  await page.screenshot({ path: ".work/preflight/titlebar-home.png" });
});

test("mobile search remains at the top and the four-item navigation stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator(".sidebar nav button")).toHaveCount(4);
  await page.getByRole("button", { name: "单词搜索", exact: true }).click();
  await page.getByRole("combobox", { name: "搜索单词" }).fill("sym");
  await expect(page.getByRole("option")).toContainText("symposium");
  await page.screenshot({ path: ".work/preflight/mobile-search.png" });
  await page.keyboard.press("Escape");
  await page.locator(".mobile-account summary").click();
  await page.locator(".mobile-account").getByRole("button", { name: "更新日志" }).click();
  await expect(page.locator(".release-detail")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("learning continues across legacy segment boundaries until the whole day is complete", async ({ page }) => {
  await setup(page, []);
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(study(page).locator("h1")).toHaveText("first");
  await study(page).locator(".session-rating button.unmastered").click();
  await expect(study(page).locator("h1")).toHaveText("symposium");
  await expect(page.getByText("本段完成", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__test.local.planDays["1"].completedAt)).toBeUndefined();
  await expect(study(page).locator(".study-word-hero .ipa")).toHaveCSS("font-family", /CYword IPA/);
  await study(page).locator(".session-rating button.unclear").click();
  await expect(study(page).locator("h1")).toHaveText("third");
  await study(page).locator(".session-rating button.mastered").click();
  await expect(study(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__test.local.planDays["1"].completedAt)).toBeTruthy();
  expect(await page.evaluate(() => (window as any).__test.local.planDays["2"])).toBeUndefined();
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.locator(".day-vessel .liquid-day-base")).toContainText("Day 2");
});

test("locked review cards explain prerequisites without creating a queue", async ({ page }) => {
  await setup(page, ["a", "b", "c", "d"]);
  await page.getByRole("button", { name: "词书计划", exact: true }).click();
  const locked = page.getByRole("button", { name: "Day 4 复习，未解锁", exact: true });
  await expect(locked.locator(".review-lock")).toBeVisible();
  await locked.click();
  await expect(page.getByRole("heading", { name: "复习尚未开放" })).toBeVisible();
  await expect(page.locator(".review-setup")).toContainText("Day 3 还有 1 个单词未标记");
  expect(await page.evaluate(() => (window as any).__test.local.planDays[4])).toBeUndefined();
  await page.getByRole("button", { name: "词书计划", exact: true }).click();
  await page.getByTitle("查看 Day 3 学习内容").click();
  await expect(page.locator(".today-plan-header")).toContainText("Day 3");
});

test("empty review requires confirmation and all-plan completion survives reload", async ({ page }) => {
  await setup(page, ids);
  await page.evaluate(() => {
    const state = (window as any).__test;
    for (const word of Object.values(state.local.words) as any[]) word.proficiency = "mastered";
    localStorage.setItem("test-progress", JSON.stringify(state.local));
  });
  await page.reload();
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(page.getByText("本轮没有需要复习的单词", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.local.planDays[4])).toBeUndefined();
  await page.getByRole("button", { name: "确认完成本轮" }).click();
  await expect(page.getByRole("heading", { name: "今天的复习已完成" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.local.reviewHistory)).toEqual([]);
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "全计划已完成" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "全计划已完成" })).toBeVisible();
});

test("review reveals only on request and local word failure can be retried", async ({ page }) => {
  await setup(page, ids);
  await page.evaluate(() => { (window as any).__test.failLoads = true; });
  await page.getByRole("button", { name: "继续学习" }).click();
  const review = page.getByRole("dialog", { name: "今日复习" });
  await expect(review.locator(".review-recall-front h2")).toHaveText("first");
  await expect(review.getByText("单词巧记", { exact: true })).toHaveCount(0);
  await review.locator(".review-recall-front").click();
  await expect(review.locator(".study-center-scroll")).toContainText("单词详情加载失败");
  await page.evaluate(() => {
    const state = (window as any).__test;
    state.failLoads = false;
    const book = (window as any).__offlineBook, original = book.readWords.bind(book);
    book.readWords = (request: any) => request.wordIds.includes("a") ? original(request) : new Promise(() => {});
  });
  await review.locator(".study-center-scroll").getByRole("button", { name: "重新加载" }).click();
  await expect(review.locator(".study-word-hero h1")).toHaveText("first");
  // 详解与学习日一致：三栏沉浸式布局，而不是旧的页面内卡片。
  await expect(review.locator(".study-morpheme-column")).toBeVisible();
  await expect(review.locator(".study-word-column")).toBeVisible();
  await review.locator(".session-rating button.unmastered").click();
  await expect(review.locator(".review-recall-front h2")).toHaveText("symposium");
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
