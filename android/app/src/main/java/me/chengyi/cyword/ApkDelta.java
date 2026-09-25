package me.chengyi.cyword;

import java.io.*;
import java.security.*;
import java.util.*;

/** Rebuild signed APK bytes exactly; never unpack/recompress or modify the installed APK. */
public final class ApkDelta {
    public static final int BLOCK_SIZE = 1024 * 1024;
    public static final long MAX_SIZE = 2L * 1024 * 1024 * 1024;
    public static final class Block {
        public final long offset;
        public final int size;
        public final String hash;
        public final byte[] inline;
        public Block(long offset, int size, String hash, byte[] inline) {
            this.offset = offset; this.size = size; this.hash = hash; this.inline = inline;
        }
        String key() { return size + ":" + hash; }
    }
    public interface Download { byte[] read(long offset, int size) throws Exception; }
    public interface Progress { void report(String phase, long completed, long total, long downloaded); }
    private static int u16(byte[] b, int p) { return (b[p] & 255) | (b[p + 1] & 255) << 8; }
    private static long u32(byte[] b, int p) { return (u16(b, p) | (long)u16(b, p + 2) << 16); }
    private static byte[] read(RandomAccessFile f, long offset, int size) throws IOException {
        byte[] b = new byte[size]; f.seek(offset); f.readFully(b); return b;
    }
    public static String hash(byte[] bytes) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) result.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return result.toString();
    }
    public static String fileHash(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[BLOCK_SIZE]; int n;
            while ((n = in.read(buf)) != -1) hash.update(buf, 0, n);
        }
        return hex(hash.digest());
    }
    // Same ZIP32 segmentation as scripts/zip-layout.mjs. Data boundaries isolate
    // timestamps/headers from large unchanged compressed entries and signing gaps.
    public static List<Block> index(File source, Progress progress) throws Exception {
        try (RandomAccessFile file = new RandomAccessFile(source, "r")) {
            long size = file.length();
            if (size < 22 || size > MAX_SIZE) throw new IOException("不支持的 APK 大小");
            byte[] tail = read(file, Math.max(0, size - 65557), (int)Math.min(size, 65557));
            int end = tail.length - 22;
            while (end >= 0 && !(u32(tail, end) == 0x06054b50L && end + 22 + u16(tail, end + 20) == tail.length)) end--;
            if (end < 0 || u32(tail, end + 4) != 0) throw new IOException("APK 目录无效");
            int count = u16(tail, end + 10); long length = u32(tail, end + 12), offset = u32(tail, end + 16);
            if (count == 65535 || length > 32 * 1024 * 1024 || offset + length != size - tail.length + end || u16(tail, end + 8) != count) throw new IOException("APK 目录超出范围");
            byte[] dir = read(file, offset, (int)length);
            TreeSet<Long> points = new TreeSet<>(Arrays.asList(0L, size));
            int cursor = 0;
            for (int i = 0; i < count; i++) {
                if (cursor + 46 > dir.length || u32(dir, cursor) != 0x02014b50L) throw new IOException("APK 条目无效");
                long compressed = u32(dir, cursor + 20), localOffset = u32(dir, cursor + 42);
                int next = cursor + 46 + u16(dir, cursor + 28) + u16(dir, cursor + 30) + u16(dir, cursor + 32);
                if (next > length || localOffset + 30 > offset || compressed == 0xffffffffL) throw new IOException("APK 范围无效");
                byte[] local = read(file, localOffset, 30);
                if (u32(local, 0) != 0x04034b50L || (u16(local, 6) & 1) != 0) throw new IOException("APK 文件头无效");
                long start = localOffset + 30 + u16(local, 26) + u16(local, 28);
                if (start + compressed > offset) throw new IOException("APK 数据越界");
                points.add(start); points.add(start + compressed); cursor = next;
            }
            if (cursor != length) throw new IOException("APK 目录长度无效");
            List<Block> blocks = new ArrayList<>(); long previous = 0;
            for (long point : points) {
                for (long start = previous; start < point; start += BLOCK_SIZE) {
                    int n = (int)Math.min(BLOCK_SIZE, point - start);
                    blocks.add(new Block(start, n, hash(read(file, start, n)), null));
                    progress.report("scanning", start + n, size, 0);
                }
                previous = point;
            }
            return blocks;
        }
    }
    public static long rebuild(File source, File target, List<Block> blocks, long size, String expectedHash, Download download, Progress progress) throws Exception {
        if (source.getCanonicalFile().equals(target.getCanonicalFile()) || size < 22 || size > MAX_SIZE || blocks.isEmpty() || blocks.size() > 150000 || !expectedHash.matches("[a-f0-9]{64}")) throw new IOException("更新信息无效");
        long end = 0;
        for (Block b : blocks) {
            if (b.offset != end || b.size <= 0 || b.size > BLOCK_SIZE || !b.hash.matches("[a-f0-9]{64}") || (b.inline != null && (b.size > 512 || b.inline.length != b.size || !hash(b.inline).equals(b.hash)))) throw new IOException("更新分块无效");
            end += b.size;
        }
        if (end != size) throw new IOException("更新文件长度不一致");
        if (target.isFile() && target.length() == size && fileHash(target).equals(expectedHash)) return 0;
        Map<String, Long> old = new HashMap<>();
        for (Block b : index(source, progress)) old.putIfAbsent(b.key(), b.offset);
        long downloaded = 0;
        try (RandomAccessFile base = new RandomAccessFile(source, "r"); RandomAccessFile out = new RandomAccessFile(target, "rw")) {
            boolean[] saved = new boolean[blocks.size()];
            for (int i = 0; i < blocks.size(); i++) {
                Block b = blocks.get(i);
                saved[i] = out.length() >= b.offset + b.size && hash(read(out, b.offset, b.size)).equals(b.hash);
            }
            long missing = 0;
            for (int i = 0; i < blocks.size(); i++) if (!saved[i] && blocks.get(i).inline == null && !old.containsKey(blocks.get(i).key())) missing += blocks.get(i).size;
            progress.report("downloading", 0, missing, 0);
            for (int i = 0; i < blocks.size(); i++) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新已暂停");
                Block b = blocks.get(i);
                if (saved[i]) continue;
                byte[] bytes;
                if (b.inline != null) bytes = b.inline;
                else if (old.containsKey(b.key())) bytes = read(base, old.get(b.key()), b.size);
                else {
                    int last = i, length = b.size;
                    while (last + 1 < blocks.size()) {
                        Block next = blocks.get(last + 1);
                        if (saved[last + 1] || next.inline != null || old.containsKey(next.key()) || length + next.size > 4 * BLOCK_SIZE) break;
                        last++; length += next.size;
                    }
                    byte[] data = download.read(b.offset, length);
                    if (data.length != length) throw new IOException("更新下载长度不一致");
                    int position = 0;
                    for (int j = i; j <= last; j++) {
                        Block part = blocks.get(j); byte[] piece = Arrays.copyOfRange(data, position, position + part.size);
                        if (!hash(piece).equals(part.hash)) throw new IOException("更新分块校验失败，请重试");
                        out.seek(part.offset); out.write(piece); position += part.size;
                    }
                    downloaded += length; i = last;
                    progress.report("downloading", downloaded, missing, downloaded);
                    continue;
                }
                if (!hash(bytes).equals(b.hash)) throw new IOException("本机资源校验失败");
                out.seek(b.offset); out.write(bytes);
            }
            out.setLength(size); out.getFD().sync();
        }
        progress.report("verifying", size, size, downloaded);
        if (!fileHash(target).equals(expectedHash)) throw new IOException("新版安装包校验失败，请重试");
        return downloaded;
    }
}
