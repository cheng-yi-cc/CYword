const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createSessionStore(target, safeStorage) {
  let operations = Promise.resolve();
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
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      requireEncryption();
      if (stored.version === 1 && typeof stored.encryptedToken === "string") {
        return { user: stored.user, token: safeStorage.decryptString(Buffer.from(stored.encryptedToken, "base64")) };
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
