import type { AppProgress } from "./types.ts";

type Adapter = {
  get: (key: string) => Promise<string | null>;
  // Native adapter commits both keys in one synchronous disk transaction.
  put: (key: string, value: string, backup?: string) => Promise<void>;
};
export function createKeyValueProgressStore(key: string, adapter: Adapter, validate: (value: unknown) => value is AppProgress,
  codec = { encode: async (value: unknown): Promise<unknown> => value, decode: async (value: unknown): Promise<unknown> => value }) {
  let operations: Promise<unknown> = Promise.resolve();
  const preserved = new Map<string, string>();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const next = operations.catch(() => undefined).then(action);
    operations = next;
    return next;
  };
  async function read(entry: string) {
    const raw = await adapter.get(entry);
    if (raw === null) return { missing: true };
    try {
      const value = await codec.decode(JSON.parse(raw));
      if (validate(value)) return { value, raw };
    } catch { /* Preserve damaged bytes before attempting any recovery. */ }
    if (preserved.get(entry) !== raw) {
      await adapter.put(`${entry}:corrupt:${crypto.randomUUID()}`, raw);
      preserved.set(entry, raw);
    }
    return { corrupt: true };
  }
  return {
    read: () => serialize(async () => {
      const primary = await read(key);
      if (primary.value) return primary.value;
      const backup = await read(`${key}:backup`);
      if (backup.value) {
        const value = { ...backup.value, localSync: { restored: backup.value.localSync?.restored === true, pending: true, recovered: true } };
        await adapter.put(key, JSON.stringify(await codec.encode(value)));
        return value;
      }
      return primary.corrupt || backup.corrupt ? { recoveryRequired: true } : null;
    }),
    write: (value: AppProgress) => serialize(async () => {
      if (!validate(value)) throw new Error("学习进度格式无效");
      const raw = JSON.stringify(await codec.encode(value));
      const primary = await read(key);
      const backup = primary.raw ?? ((await read(`${key}:backup`)).missing ? raw : undefined);
      await adapter.put(key, raw, backup);
      return true;
    }),
  };
}
