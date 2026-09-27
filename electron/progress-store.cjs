const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(JSON.stringify(value), "utf8");
    await file.sync();
    await file.close(); file = null;
    await fs.rename(temporary, target);
  } finally {
    if (file) await file.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

function createProgressStore(target, validate, codec = { encode: async value => value, decode: async value => value }) {
  const backup = `${target}.backup`;
  let operations = Promise.resolve(), lastFailure = null;
  const preserved = new Set();
  const serialize = action => {
    const pending = operations.catch(() => undefined).then(action);
    operations = pending;
    return pending;
  };
  async function readFile(file) {
    let raw;
    try { raw = await fs.readFile(file, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return { missing: true }; throw new Error("无法读取本机进度，请检查访问权限", { cause: error }); }
    try {
      const value = await codec.decode(JSON.parse(raw));
      if (!validate(value)) throw new Error("Invalid progress");
      return { value, encoded: JSON.parse(raw) };
    } catch {
      if (!preserved.has(file)) {
        await fs.copyFile(file, `${file}.corrupt-${randomUUID()}`);
        preserved.add(file);
      }
      return { corrupt: true };
    }
  }
  return {
    read: () => serialize(async () => {
      const main = await readFile(target);
      if (main.value) return main.value;
      const previous = await readFile(backup);
      if (previous.value) {
        const recovered = { ...previous.value, localSync: { restored: previous.value.localSync?.restored === true, pending: true, recovered: true } };
        await atomicWrite(target, await codec.encode(recovered));
        return recovered;
      }
      return main.corrupt || previous.corrupt ? { recoveryRequired: true } : null;
    }),
    write: value => serialize(async () => {
      try {
        if (!validate(value)) throw new Error("学习进度格式无效");
        const previous = await readFile(target);
        // Never replace a good recovery copy with a damaged primary file.
        const encoded = await codec.encode(value);
        if (previous.value) await atomicWrite(backup, previous.encoded);
        else if ((await readFile(backup)).missing) await atomicWrite(backup, encoded);
        await atomicWrite(target, encoded);
        lastFailure = null;
        return true;
      } catch (error) { lastFailure = error; throw error; }
    }),
    drain: async () => { await operations.catch(() => undefined); if (lastFailure) throw lastFailure; },
  };
}
module.exports = { createProgressStore, atomicWrite };
