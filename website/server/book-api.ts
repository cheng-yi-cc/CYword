export type BookPointer = {
  schemaVersion: number;
  bookCode: string;
  dataVersion: string;
  catalogKey: string;
};

export type BookManifest = {
  schemaVersion: number;
  bookCode: string;
  dataVersion: string;
  wordCount: number;
  shards: Record<string, number>;
  wordShard: Record<string, string>;
};

export type BookShard = {
  schemaVersion: number;
  bookCode: string;
  dataVersion: string;
  shard: string;
  words: Record<string, unknown>;
};

export const BOOK_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
export const DATA_VERSION_PATTERN = /^[a-f0-9]{16}$/u;
export const WORD_ID_PATTERN = /^[a-f0-9-]{36}$/iu;

export function jsonError(status: number, message: string, extraHeaders: Record<string, string> = {}) {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export async function readR2Json<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? object.json<T>() : null;
}

export async function readRequestJson<T>(request: Request, maxBytes: number): Promise<T> {
  if (!request.body) throw new Error("Request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Request is too large");
      throw new RangeError("Request is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as T;
}

export function routeBookCode(value: string | string[] | undefined) {
  const code = Array.isArray(value) ? value[0] : value;
  return code && BOOK_CODE_PATTERN.test(code) ? code : null;
}
