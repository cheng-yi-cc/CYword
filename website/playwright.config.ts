import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/site-ui",
  outputDir: "../.work/site-ui-results",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5174", channel: "chrome", reducedMotion: "reduce", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev:site", cwd: "..", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI },
});
