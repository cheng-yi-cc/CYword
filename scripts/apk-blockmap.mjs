import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { zipLayout } from "./zip-layout.mjs";

export async function apkBlockmap(filename, output = `${filename}.blocks.json`) {
  const layout = await zipLayout(filename), file = await open(filename, "r");
  const hash = createHash("sha256"), blocks = [];
  try {
    for (const block of layout.blocks) {
      const bytes = Buffer.alloc(block.size);
      if ((await file.read(bytes, 0, bytes.length, block.offset)).bytesRead !== bytes.length) throw Error("Truncated APK");
      hash.update(bytes);
      blocks.push({ size: block.size, sha256: createHash("sha256").update(bytes).digest("hex"), ...(block.size <= 512 ? { data: bytes.toString("base64") } : {}) });
    }
  } finally { await file.close(); }
  const manifest = { schemaVersion: 1, algorithm: "zip-sha256-1m", size: layout.size, sha256: hash.digest("hex"), blocks };
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > 16 * 1024 * 1024 || blocks.length > 150000) throw Error("APK blockmap too large");
  await writeFile(output, bytes);
  return { manifest, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), file: output };
}
