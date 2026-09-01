import {
  DATA_VERSION_PATTERN,
  WORD_ID_PATTERN,
  jsonError,
  readR2Json,
  readRequestJson,
  routeBookCode,
  type BookManifest,
  type BookShard,
} from "../../../../server/book-api.ts";

type WordsRequest = {
  dataVersion?: unknown;
  planDay?: unknown;
  kind?: unknown;
  wordIds?: unknown;
};

async function streamWords(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  bucket: R2Bucket,
  bookCode: string,
  dataVersion: string,
  wordIds: string[],
  byShard: Map<string, string[]>,
) {
  const encoder = new TextEncoder();
  let first = true;
  try {
    await writer.write(encoder.encode(`{"dataVersion":${JSON.stringify(dataVersion)},"wordCount":${wordIds.length},"words":{`));
    for (const [shard, ids] of byShard) {
      const pack = await readR2Json<BookShard>(bucket, `books/${bookCode}/${dataVersion}/shard-${shard}.json`);
      if (!pack || pack.bookCode !== bookCode || pack.dataVersion !== dataVersion) {
        throw new Error(`Missing or invalid shard ${shard}`);
      }
      for (const id of ids) {
        const detail = pack.words[id];
        if (!detail) throw new Error(`Word ${id} missing from shard ${shard}`);
        const separator = first ? "" : ",";
        first = false;
        await writer.write(encoder.encode(`${separator}${JSON.stringify(id)}:${JSON.stringify(detail)}`));
      }
    }
    await writer.write(encoder.encode("}}"));
    await writer.close();
  } catch (error) {
    console.error(JSON.stringify({
      event: "book_words_stream_failed",
      bookCode,
      dataVersion,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    await writer.abort(error);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const bookCode = routeBookCode(context.params.book);
  if (!bookCode) return jsonError(404, "Book not found");
  const contentLength = Number(context.request.headers.get("Content-Length") ?? "0");
  if (contentLength > 400_000) return jsonError(413, "Request is too large");

  let input: WordsRequest;
  try {
    input = await readRequestJson<WordsRequest>(context.request, 400_000);
  } catch (error) {
    if (error instanceof RangeError) return jsonError(413, "Request is too large");
    return jsonError(400, "Invalid JSON request");
  }
  if (typeof input.dataVersion !== "string" || !DATA_VERSION_PATTERN.test(input.dataVersion)) {
    return jsonError(400, "Invalid data version");
  }
  if (!Number.isInteger(input.planDay) || Number(input.planDay) < 1 || Number(input.planDay) > 40) {
    return jsonError(400, "Invalid plan day");
  }
  if (input.kind !== "study" && input.kind !== "review" && input.kind !== "bookmarks") {
    return jsonError(400, "Invalid request kind");
  }
  if (!Array.isArray(input.wordIds) || input.wordIds.length > 5_166) {
    return jsonError(400, "Invalid word list");
  }
  const wordIds = [...new Set(input.wordIds)];
  if (!wordIds.every((id): id is string => typeof id === "string" && WORD_ID_PATTERN.test(id))) {
    return jsonError(400, "Invalid word identifier");
  }

  try {
    const manifest = await readR2Json<BookManifest>(
      context.env.BOOKS,
      `books/${bookCode}/${input.dataVersion}/manifest.json`,
    );
    if (!manifest || manifest.bookCode !== bookCode || manifest.dataVersion !== input.dataVersion) {
      return jsonError(409, "Book data version is unavailable; reload the catalog");
    }
    const byShard = new Map<string, string[]>();
    for (const id of wordIds) {
      const shard = manifest.wordShard[id];
      if (!shard) return jsonError(400, "Word identifier is not part of this book");
      const ids = byShard.get(shard) ?? [];
      ids.push(id);
      byShard.set(shard, ids);
    }
    if (wordIds.length === 0) {
      return Response.json({ dataVersion: input.dataVersion, wordCount: 0, words: {} }, {
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }

    const stream = new TransformStream<Uint8Array, Uint8Array>();
    context.waitUntil(streamWords(
      stream.writable.getWriter(),
      context.env.BOOKS,
      bookCode,
      input.dataVersion,
      wordIds,
      byShard,
    ));
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "book_words_failed",
      bookCode,
      dataVersion: input.dataVersion,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    return jsonError(503, "Book data is temporarily unavailable", { "Retry-After": "60" });
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return jsonError(405, "Method not allowed", { Allow: "POST" });
};
