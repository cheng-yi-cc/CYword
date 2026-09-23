import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 本地预览读取已发布版本；下载测试仍使用 Wrangler 的本地 R2。
const proxy = { "/downloads/": { target: "https://cyword.chengyi.me", changeOrigin: true } };

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  base: "/",
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true, proxy },
  build: {
    outDir: fileURLToPath(new URL("../dist-site", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin/index.html", import.meta.url)),
      },
    },
  },
});
