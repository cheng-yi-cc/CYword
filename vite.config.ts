import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const localDataVersion = "0000000000000000";

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 400_000) throw new Error("Request is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localDataPreview() {
  return {
    name: "cyword-local-data-preview",
    configureServer(server: { middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? "";
        try {
          let payload: unknown;
          if (request.method === "GET" && url === "/api/books/cet6/catalog") {
            const catalog = JSON.parse(await fs.readFile(path.resolve("data/catalog.json"), "utf8"));
            payload = { ...catalog, dataVersion: localDataVersion };
          } else if (request.method === "POST" && url === "/api/books/cet6/words") {
            const input = await readRequestJson(request) as { wordIds?: unknown };
            if (!Array.isArray(input.wordIds)) throw new Error("Invalid word list");
            const words: Record<string, unknown> = {};
            for (const id of [...new Set(input.wordIds)]) {
              if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid word id");
              words[id] = JSON.parse(await fs.readFile(path.resolve("data/words", `${id}.json`), "utf8"));
            }
            payload = { dataVersion: localDataVersion, wordCount: Object.keys(words).length, words };
          } else {
            return next();
          }
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(payload));
        } catch {
          response.statusCode = 400;
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
