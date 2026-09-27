const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createSessionStore(target, safeStorage) {
  let operations = Promise.resolve();
  let preservedCorruption = false;
  async function preserveCorruption() {
    if (preservedCorruption) return;
    await fs.copyFile(target, `${target}.corrupt-${randomUUID()}`);
    preservedCorruption = true;
  }
  const serialize = (operation) => {
    const pending = operations.catch(() => undefined).then(operation);
    operations = pending;
    return pending;
  };
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
      throw new Error("系统凭据保护不可用，请稍后重试登录");
    }
  }
  async function write(session) {
    if (!session || typeof session.token !== "string" || !session.token || typeof session.user?.id !== "string") throw new Error("用户会话格式无效");
    requireEncryption();
    const stored = { version: 1, user: session.user, encryptedToken: safeStorage.encryptString(session.token).toString("base64") };
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(temporary, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
    return true;
  }
  return {
    write: (session) => serialize(() => write(session)),
    read: () => serialize(async () => {
      let stored;
      try { stored = JSON.parse(await fs.readFile(target, "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return null;
        if (!(error instanceof SyntaxError)) throw new Error("无法读取登录会话，请检查文件访问权限", { cause: error });
        await preserveCorruption();
        throw new Error("登录会话文件损坏，已保留异常副本，请重新登录");
      }
      requireEncryption();
      if (!stored || typeof stored.user?.id !== "string" || !stored.user.id) {
        await preserveCorruption();
        throw new Error("登录会话格式无效，已保留异常副本，请重新登录");
      }
      if (stored.version === 1) {
        try {
          if (typeof stored.encryptedToken !== "string" || !stored.encryptedToken) throw new Error("Missing credential");
          const token = safeStorage.decryptString(Buffer.from(stored.encryptedToken, "base64"));
          if (!token) throw new Error("Empty credential");
          return { user: stored.user, token };
        } catch {
          await preserveCorruption();
          throw new Error("登录会话无法解密，已保留异常副本，请重新登录");
        }
      }
      // Atomic replacement preserves legacy ownership metadata and never writes a plaintext backup.
      await write(stored);
      return { user: stored.user, token: stored.token };
    }),
    clear: () => serialize(async () => {
      await fs.unlink(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return true;
    }),
  };
}

module.exports = { createSessionStore };
