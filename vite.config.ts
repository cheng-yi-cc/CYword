import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { validProgress } from "./website/server/progress-sync.ts";
import { emptyProgress } from "./src/progress.ts";
import type { AppProgress } from "./src/types.ts";
import type { WordsRequest } from "./src/types.ts";
import { readLocalBook } from "./scripts/local-book-preview.ts";
import { previewMedia } from "./scripts/preview-media.mjs";

async function readRequestJson(request: IncomingMessage, timeoutMs = 5_000): Promise<unknown> {
  if ((request as unknown as { body?: unknown }).body) {
    return (request as unknown as { body?: unknown }).body;
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;

    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
    };

    const timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error("Request read timed out"));
      }
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > 12_000_000) {
        cleanup();
        reject(new Error("Request is too large"));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (finished) return;
      cleanup();
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    };

    const onError = (err: Error) => {
      if (finished) return;
      cleanup();
      reject(err);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);

    if (request.complete) {
      onEnd();
    } else {
      request.resume();
    }
  });
}

const devOtpCodes = new Map<string, { code: string; createdAt: number }>();
const devUsers = new Map<string, { id: string; email: string; createdAt: number; lastLoginAt: number; loginCount: number }>();
const devProgress = new Map<string, { revision: number; progress: AppProgress }>();
const realAuth = process.env.CYWORD_REAL_AUTH === "1";
// Browser previews cannot fetch the audio CDN directly because it has no CORS header.
// Native apps use their own HTTP transport; this proxy accepts only book audio paths.
const audioProxy = {
  "^/__book-audio/audio/[a-fA-F0-9]+\\.(?:mp3|wav)$": {
    target: "https://cdn.aimwords.com", changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/__book-audio/, ""),
  },
};

function localDataPreview() {
  const media = previewMedia(process.cwd());
  return {
    name: "cyword-local-data-preview",
    configureServer(server: { middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? "";
        if (url.startsWith("/__local-book/")) {
          try {
            response.setHeader("Cache-Control", "no-store");
            if (request.method === "GET" && url.startsWith("/__local-book/media?")) {
              const resource = await media(new URL(url, "http://localhost").searchParams.get("url"));
              const types: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
              response.setHeader("Content-Type", types[resource.extension]);
              response.end(resource.bytes);
            } else if ((request.method === "GET" && url === "/__local-book/catalog") || (request.method === "POST" && url === "/__local-book/words")) {
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify(await readLocalBook("data", request.method === "POST" ? await readRequestJson(request) as WordsRequest : undefined)));
            } else { response.statusCode = 404; response.end(); }
          } catch (error) { response.statusCode = 503; response.end(error instanceof Error ? error.message : "Local resource unavailable"); }
          return;
        }
        if (realAuth) return next();
        try {
          let payload: unknown;
          if (request.method === "GET" && url === "/api/books/cet6/catalog") {
            payload = await readLocalBook("data");
          } else if (request.method === "POST" && url === "/api/books/cet6/words") {
            payload = await readLocalBook("data", await readRequestJson(request) as WordsRequest);
          } else if (url === "/api/progress") {
            const token = (request.headers.authorization || "").replace(/^Bearer /, "");
            const user = Array.from(devUsers.values()).find((item) => `dev-jwt-token-${item.id}` === token);
            if (!user) { response.statusCode = 401; payload = { error: "登录已过期，请重新登录后同步" }; }
            else {
              const current = devProgress.get(user.id) ?? { revision: 0, progress: emptyProgress() };
              if (request.method === "GET") payload = current;
              else if (request.method === "PUT") {
                const input = await readRequestJson(request) as { revision: number; progress: AppProgress };
                if (!validProgress(input.progress) || !Number.isSafeInteger(input.revision)) { response.statusCode = 400; payload = { error: "学习进度格式无效" }; }
                else if (current.revision !== input.revision) { response.statusCode = 409; payload = current; }
                else { payload = { revision: current.revision + 1, progress: input.progress }; devProgress.set(user.id, payload as typeof current); }
              } else { response.statusCode = 405; payload = { error: "Method not allowed" }; }
            }
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
  plugins: [react(), localDataPreview(), {
    name: "cyword-installed-book",
    apply: "build",
    async writeBundle(options) {
      const source = path.resolve(".work/bundled-book");
      // Fail the build if preparation did not complete; never ship a partial book.
      await fs.access(path.join(source, "manifest.json"));
      await fs.cp(source, path.join(options.dir!, "book"), { recursive: true });
    },
  }],
  base: "./",
  optimizeDeps: { entries: ["index.html"] },
  preview: { proxy: audioProxy },
  server: {
    watch: { ignored: ["**/android/**", "**/.work/**", "**/dist-site/**", "**/release/**"] },
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      ...audioProxy,
      ...(realAuth ? {
        "/api/auth": { target: "https://cyword.chengyi.me", changeOrigin: true },
        "/api/progress": { target: "https://cyword.chengyi.me", changeOrigin: true },
      } : {}),
      "/api/books": {
        target: "https://cyword.chengyi.me",
        changeOrigin: true,
      },
    },
  },
});
