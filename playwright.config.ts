import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: ".work/ui-results",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5183", channel: "chrome", viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  // 独立服务避免复用带 HMR 时间戳的模块，导致故障注入命中另一个实例。
  webServer: { command: "npx vite --host 127.0.0.1 --port 5183 --strictPort", env: { VITE_CYWORD_BOOK_DOWNLOAD: "1" }, url: "http://127.0.0.1:5183", reuseExistingServer: false, timeout: 60000 },
});
