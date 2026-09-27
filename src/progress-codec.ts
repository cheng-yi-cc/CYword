/** Lossless transport/storage encoding. Long word IDs repeat in every cumulative
 * review; intern them once so a complete book stays below D1's row limit. */
export interface CompactProgress { encoding: "cyword-ids-v1"; ids: string[]; data: unknown }
export function encodeProgress(value: unknown): CompactProgress {
  const progress = value as { words?: Record<string, unknown> } | null;
  const ids = Object.keys(progress?.words ?? {}).sort();
  const dictionary = new Map(ids.map((id, index) => [id, `~${index}`]));
  const token = (text: string) => dictionary.get(text) ?? (text.startsWith("~") ? `~~${text}` : text);
  const map = (item: unknown): unknown => {
    if (typeof item === "string") return token(item);
    if (Array.isArray(item)) return item.map(map);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, entry]) => [token(key), map(entry)]));
    return item;
  };
  return { encoding: "cyword-ids-v1", ids, data: map(value) };
}

export function decodeProgress(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("encoding" in value)) return value;
  const packed = value as CompactProgress;
  if (packed.encoding !== "cyword-ids-v1" || !Array.isArray(packed.ids) || packed.ids.length > 10000
    || packed.ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9:_-]{1,150}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id))
    || new Set(packed.ids).size !== packed.ids.length) throw new Error("进度编码无效");
  let remaining = 1_500_000;
  const token = (text: string) => {
    if (!text.startsWith("~")) return text;
    if (text.startsWith("~~")) return text.slice(2);
    if (!/^~(?:0|[1-9]\d*)$/.test(text) || !packed.ids[Number(text.slice(1))]) throw new Error("进度引用无效");
    return packed.ids[Number(text.slice(1))];
  };
  const map = (item: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 20) throw new Error("进度编码过大");
    if (typeof item === "string") return token(item);
    if (Array.isArray(item)) return item.map(entry => map(entry, depth + 1));
    if (item && typeof item === "object") {
      const entries = Object.entries(item).map(([key, entry]) => [token(key), map(entry, depth + 1)] as const);
      if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("进度引用重复");
      return Object.fromEntries(entries);
    }
    return item;
  };
  return map(packed.data, 0);
}
