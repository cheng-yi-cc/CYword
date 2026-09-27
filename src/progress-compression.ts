import { encodeProgress, decodeProgress } from "./progress-codec.ts";
import type { AppProgress } from "./types.ts";

export async function packProgress(progress: unknown): Promise<ArrayBuffer> {
  const raw = new TextEncoder().encode(JSON.stringify(encodeProgress(progress)));
  return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

export async function unpackProgress(payload: ArrayBuffer | number[]): Promise<AppProgress> {
  const bytes = new Uint8Array(payload);
  if (bytes.length > 1_800_000) throw new RangeError("Stored progress exceeds limit");
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16_000_000) throw new RangeError("Expanded progress exceeds limit");
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  const raw = new Uint8Array(size); let offset = 0;
  for (const part of parts) { raw.set(part, offset); offset += part.length; }
  return decodeProgress(JSON.parse(new TextDecoder().decode(raw))) as AppProgress;
}

export async function encodeProgressWire(value: unknown) {
  const bytes = new Uint8Array(await packProgress(value));
  if (bytes.length > 1_800_000) throw new RangeError("学习记录过大，原记录仍保留");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { encoding: "cyword-gzip-v1", data: btoa(binary) };
}

export async function decodeProgressWire(value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object" || !("encoding" in value) || value.encoding !== "cyword-gzip-v1") return decodeProgress(value);
  const data = "data" in value && value.data;
  if (typeof data !== "string" || data.length > 2_400_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("进度压缩格式无效");
  return unpackProgress(Uint8Array.from(atob(data), char => char.charCodeAt(0)).buffer);
}
