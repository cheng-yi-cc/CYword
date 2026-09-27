import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/bundled-ui", outputDir: ".work/bundled-ui-results", workers: 1,
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:5184", channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-animated", use: { viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" } },
    { name: "desktop-reduced", use: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" } },
    { name: "mobile-animated", use: { viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" } },
  ],
  webServer: { command: "npx vite preview --host 127.0.0.1 --port 5184 --strictPort", url: "http://127.0.0.1:5184", reuseExistingServer: false, timeout: 60000 },
});
