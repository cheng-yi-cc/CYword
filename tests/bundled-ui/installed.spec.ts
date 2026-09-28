import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { installSyncPreview } from '../install-sync-preview.mjs';
import { buildPlan, studyExposures } from "../../src/progress.ts";
const catalog = JSON.parse(fs.readFileSync("dist/book/catalog.json", "utf8"));
const firstId = studyExposures(buildPlan(catalog)[0], catalog.groups)[0].wordId;
const first = catalog.words[firstId];

test('stable first run ignores Beta credentials and progress and never contacts auth or sync', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(() => {
    localStorage.setItem('cyword_session', '{"token":"beta-token","user":{"id":"beta-user"}}');
    localStorage.setItem('cyword-progress:beta-user', 'beta-record-must-survive');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '继续学习' })).toBeVisible();
  await expect(page.locator('.auth-modal, .sidebar-account, .sync-status')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.cyword.readSession)).toBe('undefined');
  await page.getByRole('button', { name: '继续学习' }).click();
  const session = page.getByRole('dialog', { name: '今日单词学习' });
  await expect(session.locator('h1')).toHaveText(first.spelling);
  await session.getByRole('button', { name: /不清楚/ }).click();
  await expect(session.locator('h1')).not.toHaveText(first.spelling);
  await page.reload();
  await page.getByRole('button', { name: '继续学习' }).click();
  await expect(session.locator('h1')).not.toHaveText(first.spelling);
  expect(await page.evaluate(() => localStorage.getItem('cyword-progress:beta-user'))).toBe('beta-record-must-survive');
  expect(requests).toEqual([]);
});

async function setup(page: Page) {

  await page.addInitScript(({ catalog }) => {
    const empty = { version: 2, planDays: {}, words: {}, bookmarks: {}, reviewHistory: [] };
    const state = { local: JSON.parse(localStorage.getItem("test-installed-progress") || "null"), remote: structuredClone(empty), revision: 0, apiReads: 0, exitPrepare: null as any, exitRelease: null as any };
    (window as any).__installed = state;
    // Only account transport is isolated. All book, image, audio and font bytes
    // are fetched from the actual production build, with no downloaded-book API.
    window.cyword = {
      readSession: async () => { throw new Error("正式版不得读取 Beta 登录"); },
      readProgress: async () => state.local,
      writeProgress: async progress => { state.local = structuredClone(progress); localStorage.setItem("test-installed-progress", JSON.stringify(progress)); return true; },
      readCatalog: async () => { state.apiReads++; throw new Error("Installed book must not use the catalog API"); },
      readWords: async () => { state.apiReads++; throw new Error("Installed book must not download words"); },
      progressRequest: async (_token, operation) => {
        (state as any).request ??= (window as any).IncrementalMock.createProgressPreview(catalog, state);
        return (state as any).request(operation);
      },
      onPrepareExit: (prepare, release) => { state.exitPrepare = prepare; state.exitRelease = release; return () => { state.exitPrepare = null; }; },
    } as any;
    indexedDB.open = () => { throw new Error("Installed wordbook must not copy to IndexedDB"); };
  }, { catalog });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "继续学习" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载词书", exact: true })).toHaveCount(0);
}

test("production bundle opens the complete book, reads local media, saves and resumes", async ({ page }, info) => {
  await setup(page);
  await page.getByRole("button", { name: "继续学习" }).click();
  const session = page.getByRole("dialog", { name: "今日单词学习" });
  await expect(session.locator("h1")).toHaveText(first.spelling);
  const image = session.locator(".rich-text img").first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const audioResponse = page.waitForResponse(response => response.url().includes("/book/audio/") && response.ok());
  await session.locator(".study-word-hero .audio-button").click();
  await audioResponse;
  await expect(session.locator(".study-word-hero .audio-button")).not.toHaveAccessibleName("重试发音");
  await session.getByRole("button", { name: /不清楚/ }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__installed.local.words[id]?.proficiency, firstId)).toBe("unclear");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `.work/preflight/bundled-${info.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "继续学习" })).toBeVisible();
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(session.locator("h1")).not.toHaveText(first.spelling);
  expect(await page.evaluate(() => (window as any).__installed.apiReads)).toBe(0);
});

test("a missing installed image keeps the word readable and can retry in place", async ({ page }) => {
  // Keep the fault active until an actual retry click; unblocking earlier can
  // let an unrelated render recover the image before Playwright clicks it.
  await page.addInitScript(() => document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest(".image-retry")) (window as any).__allowImages = true;
  }, true));
  await page.route("**/book/images/**", async route => {
    if (await page.evaluate(() => Boolean((window as any).__allowImages))) await route.continue();
    else await route.abort();
  });
  await setup(page);
  await page.getByRole("button", { name: "继续学习" }).click();
  const session = page.getByRole("dialog", { name: "今日单词学习" });
  await expect(session.locator("h1")).toHaveText(first.spelling);
  await expect(session.getByRole("button", { name: "配图加载失败，点击重试" }).first()).toBeVisible();
  expect(await page.evaluate(id => (window as any).__installed.local.words[id], firstId)).toBeUndefined();
  await session.getByRole("button", { name: "配图加载失败，点击重试" }).first().click();
  await expect.poll(() => session.locator(".rich-text img").first().evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(session.getByRole("button", { name: /不清楚/ })).toBeEnabled();
});
