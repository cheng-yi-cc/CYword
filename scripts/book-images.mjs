import { marked } from "marked";

// Parse the same Markdown image tokens that the UI renders, leaving all source text intact.
export function bookImageUrls(value, urls = new Set()) {
  if (typeof value === "string" && (value.includes("![") || value.includes("<img"))) {
    marked.walkTokens(marked.lexer(value), token => {
      const sources = token.type === "image" ? [token.href] : token.type === "html"
        ? [...token.text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]) : [];
      for (const source of sources) {
        const url = new URL(source);
        if (url.origin !== "https://cdn.aimwords.com" || !/\.(png|jpe?g|webp|gif)$/i.test(url.pathname) || url.username || url.password || url.search || url.hash) throw Error(`Unsupported book image: ${source}`);
        urls.add(url.href);
      }
    });
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) bookImageUrls(item, urls);
  }
  return urls;
}

export function imageExtension(bytes) {
  if (!bytes.length || bytes.length > 20_000_000) return false;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return false;
}
