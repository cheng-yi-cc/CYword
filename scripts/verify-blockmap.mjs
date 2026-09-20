import { open, readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { blake2b } from "@noble/hashes/blake2.js";

/** 校验 updater v2 blockmap 的每个分块确实对应这份安装器。 */
export async function verifyBlockmap(installer, blockmap) {
  let map;
  try {
    if ((await stat(blockmap)).size > 16 * 1024 * 1024) throw new Error("too large");
    map = JSON.parse(gunzipSync(await readFile(blockmap), { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8"));
  } catch { throw new Error("blockmap 必须是有效的 gzip 压缩分块清单"); }
  const file = map?.files?.[0];
  if (map.version !== "2" || !Array.isArray(map.files) || map.files.length !== 1 || file?.name !== "file" || file.offset !== 0
    || !Array.isArray(file.sizes) || !file.sizes.length || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length
    || file.sizes.some(size => !Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024)) throw new Error("blockmap 分块结构无效");
  const size = (await stat(installer)).size;
  if (file.sizes.reduce((sum, length) => sum + length, 0) !== size) throw new Error("blockmap 分块总长度与安装器不一致");
  const source = await open(installer, "r");
  try {
    let offset = 0;
    for (let index = 0; index < file.sizes.length; index++) {
      const length = file.sizes[index], buffer = Buffer.alloc(length);
      const { bytesRead } = await source.read(buffer, 0, length, offset);
      const checksum = Buffer.from(blake2b(buffer, { dkLen: 18 })).toString("base64");
      if (bytesRead !== length || checksum !== file.checksums[index]) throw new Error(`blockmap 第 ${index + 1} 块与安装器不一致`);
      offset += length;
    }
  } finally { await source.close(); }
}
