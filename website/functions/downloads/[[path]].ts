type ByteRange = { offset: number; length: number };

import { isReleasePointer, toPublicRelease, releaseNotesUrl, type ReleasePointer, type PublicRelease } from "../../server/release-manifest";

type DownloadAsset = {
  key: string;
  filename?: string;
  contentType: string;
  immutable: boolean;
  allowRange: boolean;
};

const currentReleaseKey = "releases/current.json";
const fallbackRelease: PublicRelease = {
  version: "0.4.4",
  publishedAt: "2026-09-20T07:33:38.463Z",
  filename: "CYword-Setup-0.4.4.exe",
  sizeBytes: 129150572,
  sha256: "985ac100038fe023c23e921a4e86889d1374a2f9b5d8f2fd6f71eb6cd7ded9c0",
  downloadPath: "/downloads/releases/0.4.4/985ac100038fe023c23e921a4e86889d1374a2f9b5d8f2fd6f71eb6cd7ded9c0/CYword-Setup-0.4.4.exe",
  notesUrl: releaseNotesUrl,
};

function readRange(value: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!value) return null;
  // 不实现 multipart/byteranges；按 HTTP 语义忽略不支持的多段或无效格式。
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Math.min(Number(match[2]), size);
    return length > 0 ? { offset: size - length, length } : "unsatisfiable";
  }
  const offset = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (offset >= size || end < offset) return "unsatisfiable";
  return { offset, length: end - offset + 1 };
}

function etagMatches(value: string, etag: string, weak = false): boolean {
  return value.split(",").some((part) => {
    const tag = part.trim();
    return tag === "*" || (weak ? tag.replace(/^W\//, "") : tag) === etag;
  });
}

function notModifiedSince(value: string | null, uploaded: Date): boolean {
  return value !== null && Math.floor(uploaded.getTime() / 1000) * 1000 <= Date.parse(value);
}

function errorResponse(request: Request, status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

async function readCurrentRelease(bucket: R2Bucket, android = false): Promise<ReleasePointer | null> {
  const object = await bucket.get(android ? "releases/android/current.json" : currentReleaseKey);
  if (!object) return null;
  if (object.size > 16 * 1024) throw new Error("Release pointer exceeds 16 KiB");
  const value = await object.json<unknown>();
  if (!isReleasePointer(value, android)) throw new Error("Release pointer is invalid");
  return value;
}

function jsonResponse(request: Request, value: PublicRelease): Response {
  const body = `${JSON.stringify(value)}\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function redirectToLatest(request: Request, release: PublicRelease): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(release.downloadPath, request.url).toString(),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function resolveVersionedAsset(pathname: string): DownloadAsset | null {
  const apkMap = /^\/downloads\/(releases\/android\/(\d+\.\d+\.\d+)\/[a-f0-9]{64}\/CYword-Android-(\d+\.\d+\.\d+)\.apk\.blocks\.json)$/.exec(pathname);
  if (apkMap && apkMap[2] === apkMap[3]) return { key: apkMap[1], contentType: "application/json", immutable: true, allowRange: false };
  const apk = /^\/downloads\/(releases\/android\/(\d+\.\d+\.\d+)\/[a-f0-9]{64}\/(CYword-Android-(\d+\.\d+\.\d+)\.apk))$/.exec(pathname);
  if (apk && apk[2] === apk[4]) return {
    key: apk[1], filename: apk[3], contentType: "application/vnd.android.package-archive",
    immutable: true, allowRange: true,
  };
  const match = /^\/downloads\/(releases\/(\d+\.\d+\.\d+)\/([a-f0-9]{64})\/(CYword-Setup-(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?))$/.exec(pathname);
  if (!match || match[2] !== match[5]) return null;
  const filename = match[4];
  const blockmap = filename.endsWith(".blockmap");
  return {
    key: match[1],
    ...(blockmap ? {} : { filename }),
    contentType: "application/octet-stream",
    immutable: true,
    allowRange: true,
  };
}

function resolveLegacyInstaller(pathname: string): DownloadAsset | null {
  const match = /^\/downloads\/(CYword-Setup-\d+\.\d+\.\d+\.exe)$/.exec(pathname);
  return match ? {
    key: match[1],
    filename: match[1],
    contentType: "application/octet-stream",
    immutable: true,
    allowRange: true,
  } : null;
}

async function serveObject(request: Request, bucket: R2Bucket, asset: DownloadAsset): Promise<Response> {
  const metadata = await bucket.head(asset.key);
  if (!metadata) {
    // electron-updater substitutes the version but leaves the new installer hash in
    // the old blockmap URL. Resolve only this known shape to a unique old release.
    const oldMap = /^releases\/(\d+\.\d+\.\d+)\/[a-f0-9]{64}\/(CYword-Setup-\1\.exe\.blockmap)$/.exec(asset.key);
    if (oldMap) {
      const prefix = `releases/${oldMap[1]}/`;
      const listing = await bucket.list({ prefix, limit: 100 });
      const candidates = listing.objects.filter(object => new RegExp(`^[a-f0-9]{64}/${oldMap[2].replaceAll(".", "\\.")}$`).test(object.key.slice(prefix.length)));
      if (!listing.truncated && candidates.length === 1) return new Response(null, { status: 302, headers: {
        Location: new URL(`/downloads/${candidates[0].key}`, request.url).href,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    return errorResponse(request, 404, "Download not found");
  }

  const headers = new Headers({
    "Content-Type": asset.contentType,
    "Content-Length": String(metadata.size),
    "ETag": metadata.httpEtag,
    "Last-Modified": metadata.uploaded.toUTCString(),
    "Cache-Control": asset.immutable ? "public, max-age=31536000, immutable, no-transform" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  if (asset.filename) headers.set("Content-Disposition", `attachment; filename="${asset.filename}"`);
  if (asset.allowRange) headers.set("Accept-Ranges", "bytes");

  const ifMatch = request.headers.get("If-Match");
  const ifUnmodified = request.headers.get("If-Unmodified-Since");
  if ((ifMatch && !etagMatches(ifMatch, metadata.httpEtag)) ||
      (!ifMatch && ifUnmodified && Number.isFinite(Date.parse(ifUnmodified)) && !notModifiedSince(ifUnmodified, metadata.uploaded))) {
    return errorResponse(request, 412, "Precondition failed");
  }

  const ifNoneMatch = request.headers.get("If-None-Match");
  if ((ifNoneMatch && etagMatches(ifNoneMatch, metadata.httpEtag, true)) ||
      (!ifNoneMatch && notModifiedSince(request.headers.get("If-Modified-Since"), metadata.uploaded))) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }

  // HEAD 不读取文件内容，且按 HTTP 语义忽略 Range。
  if (request.method === "HEAD") return new Response(null, { headers });

  const ifRange = request.headers.get("If-Range");
  const useRange = asset.allowRange && (!ifRange || ifRange === metadata.httpEtag ||
    (!ifRange.startsWith('"') && !ifRange.startsWith("W/") && notModifiedSince(ifRange, metadata.uploaded)));
  const range = useRange ? readRange(request.headers.get("Range"), metadata.size) : null;
  if (range === "unsatisfiable") {
    return errorResponse(request, 416, "Range not satisfiable", {
      "Content-Range": `bytes */${metadata.size}`,
      "Accept-Ranges": "bytes",
    });
  }

  const object = await bucket.get(asset.key, {
    ...(range ? { range } : {}),
    // 避免 HEAD 与 GET 之间文件被替换，导致分段和缓存对应错文件。
    onlyIf: { etagMatches: metadata.etag },
  });
  if (!object) return errorResponse(request, 404, "Download not found");
  if (!("body" in object)) {
    return errorResponse(request, 503, "Download changed; retry", { "Retry-After": "60" });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
    headers.set("Content-Length", String(range.length));
  }

  // 安装包可能超过 Worker 内存限制，始终直接返回 R2 流。
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

const serveDownload: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(request, 405, "Method not allowed", { Allow: "GET, HEAD" });
  }

  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === "/downloads/android/latest" || pathname === "/downloads/android/latest.json") {
      const pointer = await readCurrentRelease(env.DOWNLOADS, true);
      if (!pointer) return errorResponse(request, 404, "Android release not published");
      const release = toPublicRelease(pointer);
      return pathname.endsWith(".json") ? jsonResponse(request, release) : redirectToLatest(request, release);
    }
    if (pathname === "/downloads/latest" || pathname === "/downloads/latest.json") {
      const pointer = await readCurrentRelease(env.DOWNLOADS);
      const release = pointer ? toPublicRelease(pointer) : fallbackRelease;
      return pathname.endsWith(".json") ? jsonResponse(request, release) : redirectToLatest(request, release);
    }

    if (pathname === "/downloads/latest.yml") {
      const pointer = await readCurrentRelease(env.DOWNLOADS);
      if (!pointer?.updaterMetadataPath) return errorResponse(request, 404, "Update metadata not published");
      return await serveObject(request, env.DOWNLOADS, {
        key: pointer.updaterMetadataPath,
        contentType: "application/x-yaml; charset=utf-8",
        immutable: false,
        allowRange: false,
      });
    }

    // 只公开稳定指针、受约束的内容寻址资产和迁移前的版本化安装包；不列目录、不代理任意 URL。
    const asset = resolveVersionedAsset(pathname) ?? resolveLegacyInstaller(pathname);
    if (!asset) return errorResponse(request, 404, "Download not found");
    return await serveObject(request, env.DOWNLOADS, asset);
  } catch (error) {
    console.error(JSON.stringify({
      event: "release_download_failed",
      pathname,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    return errorResponse(request, 503, "Download temporarily unavailable; please retry later", { "Retry-After": "60" });
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await serveDownload(context);
  const pathname = new URL(context.request.url).pathname;
  if (pathname === "/downloads/latest.json" || pathname === "/downloads/android/latest.json") {
    // Capability is independent of whether a current release has been published.
    response.headers.set("X-CYword-Release-Schemas", "1,2");
    if (pathname === "/downloads/android/latest.json") response.headers.set("X-CYword-Android-Differential", "zip-sha256-1m");
  }
  return response;
};
