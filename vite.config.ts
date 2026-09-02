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

const devOtpCodes = new Map<string, { code: string; createdAt: number }>();
const devUsers = new Map<string, { id: string; email: string; createdAt: number; lastLoginAt: number; loginCount: number }>();

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
          } else if (request.method === "POST" && url === "/api/auth/send-code") {
            const input = await readRequestJson(request) as { email?: string };
            const email = (input.email || "").trim().toLowerCase();
            if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ error: "请输入有效的电子邮箱" }));
              return;
            }
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            devOtpCodes.set(email, { code, createdAt: Date.now() });
            payload = {
              success: true,
              message: "验证码已生成（本地开发模拟）",
              simulated: true,
              debugCode: code,
            };
          } else if (request.method === "POST" && url === "/api/auth/verify-code") {
            const input = await readRequestJson(request) as { email?: string; code?: string };
            const email = (input.email || "").trim().toLowerCase();
            const code = (input.code || "").trim();
            const record = devOtpCodes.get(email);
            if (!record || record.code !== code) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ error: "验证码错误或已失效" }));
              return;
            }
            devOtpCodes.delete(email);
            const now = Date.now();
            let user = devUsers.get(email);
            if (user) {
              user.lastLoginAt = now;
              user.loginCount += 1;
            } else {
              user = {
                id: `dev-user-${Date.now()}`,
                email,
                createdAt: now,
                lastLoginAt: now,
                loginCount: 1,
              };
              devUsers.set(email, user);
            }
            payload = {
              success: true,
              token: `dev-jwt-token-${user.id}`,
              user,
            };
          } else if (request.method === "GET" && url === "/api/auth/me") {
            const authHeader = request.headers.authorization || "";
            const token = authHeader.replace("Bearer ", "").trim();
            let matchedUser = Array.from(devUsers.values()).find((u) => `dev-jwt-token-${u.id}` === token);
            if (!matchedUser) {
              matchedUser = {
                id: "dev-user-default",
                email: "developer@cyword.test",
                createdAt: Date.now(),
                lastLoginAt: Date.now(),
                loginCount: 1,
              };
            }
            payload = { success: true, user: matchedUser };
          } else {
            return next();
          }
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(payload));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Local preview error" }));
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
