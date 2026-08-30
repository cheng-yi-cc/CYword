import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

function localDataPreview() {
  return {
    name: "cyword-local-data-preview",
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? "";
        let filePath = "";
        if (url === "/api/catalog") {
          filePath = path.resolve("data/catalog.json");
        } else {
          const match = url.match(/^\/api\/word\/([a-f0-9-]{36})$/i);
          if (match) filePath = path.resolve("data/words", `${match[1]}.json`);
        }
        if (!filePath) return next();
        try {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(await fs.readFile(filePath, "utf8"));
        } catch {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: "Local preview data was not found" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localDataPreview()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
