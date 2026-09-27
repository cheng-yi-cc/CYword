import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const output = path.resolve('.work/preflight/render');
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ['tests/full-book-render-harness.tsx'], bundle: true, outdir: output, format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_CYWORD_PROGRESS_MODE': '"cloud"', 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'file', '.jpg': 'file', '.png': 'file', '.webp': 'file' } });
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/full-book-render-harness.css"><body><main id="audit"></main><script type="module" src="/full-book-render-harness.js"></script></body></html>';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); return; }
    const base = url.pathname.startsWith('/book/') ? path.resolve('dist') : output;
    const file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + path.sep)) throw Error('Invalid path');
    const bytes = await fs.readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(origin); await page.waitForFunction(() => Array.isArray(window.auditIds));
  const total = await page.evaluate(() => window.auditIds.length), start = performance.now();
  let counts;
  for (let index = 0; index < total; index += 50) {
    counts = await page.evaluate(index => window.auditWords(index, 50), index);
    if (errors.length || external.length) throw Error(JSON.stringify({ index, errors, external }));
    if (index % 500 === 0) console.log(`Rendered ${counts.words}/${total}`);
  }
  const decodedImages = await page.evaluate(() => window.auditImages());
  const report = { ...counts, decodedImages, seconds: Math.round((performance.now() - start) / 1000), browser: await browser.version(), source: 'Actual WordDetailPanel and enhancement providers; every dist/book word and available tab; all referenced images decoded. No audio listening claim.', errors, externalRequests: external.length };
  await page.screenshot({ path: path.join(output, 'last-word.png'), fullPage: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length || external.length || counts.words !== 5166) throw Error(JSON.stringify(report));
  console.log(report);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
