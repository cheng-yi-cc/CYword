import { test, expect } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`demo segmentation follows playback and restores at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/downloads/**", route => route.fulfill({ status: 503 }));
    await page.addInitScript(() => {
      window.Audio = class extends EventTarget {
        constructor() { super(); (window as any).__audio = this; }
        play() { return Promise.resolve(); }
        pause() {}
      } as any;
    });
    await page.goto("/");
    const spelling = page.locator(".study-word-title .sound-spelling");
    const audio = page.locator(".study-audio-btn");
    await expect(spelling).toHaveText("portable");
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await spelling.click();
    await expect(spelling.locator(".sound-spelling-part")).toHaveText(["por", "ta", "ble"]);
    await spelling.click();
    await audio.locator("strong").click();
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => (window as any).__audio.dispatchEvent(new Event("ended")));
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await spelling.focus(); await page.keyboard.press("Enter");
    await audio.click();
    await page.evaluate(() => (window as any).__audio.dispatchEvent(new Event("ended")));
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await spelling.click();
    await audio.click(); await audio.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await audio.click();
    await page.evaluate(() => (window as any).__audio.dispatchEvent(new Event("error")));
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    await expect(audio).toContainText("重试发音");
    await audio.click();
    await expect(spelling).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => (window as any).__audio.dispatchEvent(new Event("ended")));
    await expect(spelling).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await spelling.click();
    await page.screenshot({ path: `.work/preflight/site-segmentation-${width}.png` });
  });
}
