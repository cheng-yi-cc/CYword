import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: ".work/ui-results",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5173", channel: "chrome", viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npx vite --host 127.0.0.1 --port 5173", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 60000 },
});
