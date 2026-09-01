import { jsonError, readR2Json, routeBookCode, type BookPointer } from "../../../../server/book-api.ts";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const bookCode = routeBookCode(context.params.book);
  if (!bookCode) return jsonError(404, "Book not found");

  try {
    const pointer = await readR2Json<BookPointer>(context.env.BOOKS, `books/${bookCode}/current.json`);
    if (!pointer || pointer.bookCode !== bookCode) return jsonError(404, "Book not found");
    const catalog = await context.env.BOOKS.get(pointer.catalogKey);
    if (!catalog) return jsonError(503, "Book catalog is temporarily unavailable", { "Retry-After": "60" });
    return new Response(catalog.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "book_catalog_failed",
      bookCode,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    return jsonError(503, "Book catalog is temporarily unavailable", { "Retry-After": "60" });
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return jsonError(405, "Method not allowed", { Allow: "GET" });
};
