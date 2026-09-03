import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

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
      if (size > 400_000) {
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

function localDataPreview() {
  return {
    name: "cyword-local-data-preview",
    configureServer(server: { middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? "";
        try {
          let payload: unknown;
          if (request.method === "POST" && url === "/api/auth/send-code") {
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
    proxy: {
      "/api/books": {
        target: "https://cyword.chengyi.me",
        changeOrigin: true,
      },
    },
  },
});
