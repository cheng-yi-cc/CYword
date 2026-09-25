import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipLayout, readZipEntry } from "./zip-layout.mjs";

// Read existing build output or a local APK in place. No extraction, bulk fetch or IDB copy.
export function previewMedia(root) {
  let sources;
  async function discover() {
    const found = [];
    for (const dir of [process.env.CYWORD_PREVIEW_BOOK, "dist/book", ".work/bundled-book", "android/app/src/main/assets/public/book"].filter(Boolean)) {
      const base = path.resolve(root, dir);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(base, "manifest.json"), "utf8"));
        found.push({ manifest, read: file => fs.readFile(path.join(base, file)) });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const release = path.join(root, "release");
    const apks = (await fs.readdir(release).catch(() => [])).filter(name => /^CYword-Android-\d+\.\d+\.\d+\.apk$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of apks) {
      const filename = path.join(release, name), layout = await zipLayout(filename);
      const read = file => readZipEntry(filename, layout.entries.get(`assets/public/book/${file}`));
      if (!layout.entries.has("assets/public/book/manifest.json")) continue;
      found.push({ manifest: JSON.parse((await read("manifest.json")).toString()), read });
    }
    return found;
  }
  return async url => {
    for (const source of await (sources ??= discover())) {
      const entry = source.manifest.audio?.[url] ?? source.manifest.images?.[url];
      if (!entry) continue;
      if (!/^(audio|images)\/[a-f0-9]+\.(mp3|wav|ogg|png|jpg|webp|gif)$/i.test(entry.file)) throw Error("Invalid preview media");
      const bytes = await source.read(entry.file);
      if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw Error("Local media checksum mismatch");
      return { bytes, extension: path.extname(entry.file).slice(1) };
    }
    throw Error("本机缺少此资源，请保留 release 下的完整 APK，或设置 CYWORD_PREVIEW_BOOK 指向已有 book 目录");
  };
}
