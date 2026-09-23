import { authenticateAdmin } from "../../server/admin/access.ts";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const admin = await authenticateAdmin(request, env);
  if (admin instanceof Response) return admin;
  const url = new URL(request.url);
  url.pathname = "/admin/";
  const asset = await env.ASSETS.fetch(url);
  const response = new Response(asset.body, asset);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};
