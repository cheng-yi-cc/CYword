package me.chengyi.cyword;

import java.io.*;
import java.net.*;

public final class UpdateTransport {
    public static byte[] read(String url, int size, Long offset, long total) throws Exception {
        if (size < 1 || size > 16 * 1024 * 1024) throw new IOException("下载大小无效");
        HttpURLConnection connection = (HttpURLConnection)new URL(url).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (offset != null) connection.setRequestProperty("Range", "bytes=" + offset + "-" + (offset + size - 1));
        try {
            int expectedStatus = offset == null ? 200 : 206;
            String range = "bytes " + offset + "-" + (offset == null ? 0 : offset + size - 1) + "/" + total;
            if (connection.getResponseCode() != expectedStatus || (offset != null && !range.equals(connection.getHeaderField("Content-Range")))) throw new IOException("差量下载暂不可用，请重试或选择完整安装包");
            long length = connection.getContentLengthLong();
            if (length != -1 && length != size) throw new IOException("下载长度无效");
            try (InputStream in = connection.getInputStream()) {
                byte[] bytes = new byte[size]; int read = 0, n;
                while (read < size && (n = in.read(bytes, read, size - read)) != -1) read += n;
                if (read != size || in.read() != -1) throw new IOException("下载不完整，请重试");
                return bytes;
            }
        } finally { connection.disconnect(); }
    }
}
