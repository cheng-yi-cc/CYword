type ByteRange = { offset: number; length: number };

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

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(request, 405, "Method not allowed", { Allow: "GET, HEAD" });
  }

  const pathname = new URL(request.url).pathname;
  // 只公开稳定版安装包，不列目录，也不接受任意 URL、桶名或路径。
  const match = /^\/downloads\/(CYword-Setup-\d+\.\d+\.\d+\.exe)$/.exec(pathname);
  if (!match) return errorResponse(request, 404, "Installer not found");
  const filename = match[1];

  try {
    const metadata = await env.DOWNLOADS.head(filename);
    if (!metadata) return errorResponse(request, 404, "Installer not found");

    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(metadata.size),
      "Accept-Ranges": "bytes",
      "ETag": metadata.httpEtag,
      "Last-Modified": metadata.uploaded.toUTCString(),
      "Cache-Control": "public, max-age=86400, immutable, no-transform",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });

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
    const useRange = !ifRange || ifRange === metadata.httpEtag ||
      (!ifRange.startsWith('"') && !ifRange.startsWith("W/") && notModifiedSince(ifRange, metadata.uploaded));
    const range = useRange ? readRange(request.headers.get("Range"), metadata.size) : null;
    if (range === "unsatisfiable") {
      return errorResponse(request, 416, "Range not satisfiable", {
        "Content-Range": `bytes */${metadata.size}`,
        "Accept-Ranges": "bytes",
      });
    }

    const object = await env.DOWNLOADS.get(filename, {
      ...(range ? { range } : {}),
      // 避免 HEAD 与 GET 之间文件被替换，导致分段和缓存对应错文件。
      onlyIf: { etagMatches: metadata.etag },
    });
    if (!object) return errorResponse(request, 404, "Installer not found");
    if (!("body" in object)) {
      return errorResponse(request, 503, "Installer changed; retry the download", { "Retry-After": "60" });
    }
    if (range) {
      headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
      headers.set("Content-Length", String(range.length));
    }

    // 直接返回 R2 的流；134 MB 安装包不能整体读入 Worker 的 128 MB 内存。
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "installer_download_failed", filename, message: error instanceof Error ? error.message : "Unknown error" }));
    return errorResponse(request, 503, "Download temporarily unavailable; please retry later", { "Retry-After": "60" });
  }
};
