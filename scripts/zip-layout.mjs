import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

export const blockSize = 1024 * 1024;
export const maxApkSize = 2 * 1024 * 1024 * 1024;
async function read(file, offset, size) {
  const bytes = Buffer.alloc(size);
  const result = await file.read(bytes, 0, size, offset);
  if (result.bytesRead !== size) throw Error("Truncated ZIP");
  return bytes;
}

/** ZIP32 only: APK signing blocks are gaps, preserved verbatim in the layout. */
export async function zipLayout(filename) {
  const file = await open(filename, "r");
  try {
    const size = (await file.stat()).size;
    if (size < 22 || size > maxApkSize) throw Error("Unsupported APK size");
    const tail = await read(file, Math.max(0, size - 65557), Math.min(size, 65557));
    let end = tail.length - 22;
    while (end >= 0 && !(tail.readUInt32LE(end) === 0x06054b50 && end + 22 + tail.readUInt16LE(end + 20) === tail.length)) end--;
    if (end < 0 || tail.readUInt32LE(end + 4) !== 0) throw Error("Invalid ZIP end");
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || length > 32 * 1024 * 1024 || offset + length !== size - tail.length + end || tail.readUInt16LE(end + 8) !== count) throw Error("Unsupported ZIP directory");
    const directory = await read(file, offset, length), entries = new Map();
    const boundaries = new Set([0, size]);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) throw Error("Invalid ZIP entry");
      const compressed = directory.readUInt32LE(cursor + 20), bytes = directory.readUInt32LE(cursor + 24);
      const nameSize = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42), method = directory.readUInt16LE(cursor + 10);
      if (localOffset + 30 > offset || compressed === 0xffffffff || cursor + 46 + nameSize + extra + comment > length) throw Error("Invalid ZIP range");
      const local = await read(file, localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || (local.readUInt16LE(6) & 1)) throw Error("Invalid ZIP header");
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + compressed > offset) throw Error("Invalid ZIP data");
      const name = directory.toString("utf8", cursor + 46, cursor + 46 + nameSize);
      if (entries.has(name)) throw Error("Duplicate ZIP entry");
      entries.set(name, { start, compressed, bytes, method });
      boundaries.add(start); boundaries.add(start + compressed);
      cursor += 46 + nameSize + extra + comment;
    }
    if (cursor !== length) throw Error("Invalid ZIP directory length");
    const points = [...boundaries].sort((a, b) => a - b), blocks = [];
    for (let i = 1; i < points.length; i++) for (let start = points[i - 1]; start < points[i]; start += blockSize) blocks.push({ offset: start, size: Math.min(blockSize, points[i] - start) });
    return { size, entries, blocks };
  } finally { await file.close(); }
}

export async function readZipEntry(filename, entry) {
  if (!entry || entry.bytes > 32 * 1024 * 1024 || entry.compressed > 32 * 1024 * 1024) throw Error("Invalid ZIP resource");
  const file = await open(filename, "r");
  try {
    const compressed = await read(file, entry.start, entry.compressed);
    const bytes = entry.method === 0 ? compressed : entry.method === 8 ? inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }) : null;
    if (!bytes || bytes.length !== entry.bytes) throw Error("Invalid ZIP resource size");
    return bytes;
  } finally { await file.close(); }
}
