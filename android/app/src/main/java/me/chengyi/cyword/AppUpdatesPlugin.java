package me.chengyi.cyword;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.provider.Settings;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private File prepared;
    private String preparedHash, preparedVersion;
    private static final String ORIGIN = "https://cyword.chengyi.me";
    private long lastProgress;

    private static boolean validUrl(String url) {
        return url.matches("https://cyword\\.chengyi\\.me/downloads/releases/android/(\\d+\\.\\d+\\.\\d+)/[a-f0-9]{64}/CYword-Android-\\1\\.apk");
    }
    private void progress(String phase, long completed, long total, long downloaded) {
        long now = System.nanoTime();
        if (completed != total && now - lastProgress < 200_000_000) return;
        lastProgress = now;
        JSObject value = new JSObject(); value.put("phase", phase); value.put("completed", completed); value.put("total", total); value.put("downloaded", downloaded);
        notifyListeners("progress", value);
    }
    @PluginMethod
    public void prepareUpdate(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("更新正在进行"); return; }
        worker.execute(() -> {
            try {
                prepared = null;
                JSObject release = call.getObject("release");
                if (release == null) throw new IOException("更新信息无效");
                String url = ORIGIN + release.getString("downloadPath"), hash = release.getString("sha256"), version = release.getString("version");
                long size = release.getLong("sizeBytes");
                if (!validUrl(url) || !hash.matches("[a-f0-9]{64}") || !url.endsWith("/" + hash + "/CYword-Android-" + version + ".apk") || size < 22 || size > ApkDelta.MAX_SIZE) throw new IOException("更新地址无效");
                JSONObject map = release.getJSONObject("differential");
                int mapSize = map.getInt("sizeBytes"); String mapHash = map.getString("sha256");
                if (!map.getString("path").equals(release.getString("downloadPath") + ".blocks.json") || mapSize < 1 || mapSize > 16 * 1024 * 1024 || !mapHash.matches("[a-f0-9]{64}")) throw new IOException("差量清单无效");
                progress("scanning", 0, size, 0);
                byte[] raw = UpdateTransport.read(url + ".blocks.json", mapSize, null, 0);
                if (!ApkDelta.hash(raw).equals(mapHash)) throw new IOException("差量清单校验失败");
                JSONObject manifest = new JSONObject(new String(raw, java.nio.charset.StandardCharsets.UTF_8));
                if (manifest.getInt("schemaVersion") != 1 || !manifest.getString("algorithm").equals("zip-sha256-1m") || manifest.getLong("size") != size || !manifest.getString("sha256").equals(hash)) throw new IOException("差量清单不匹配");
                JSONArray entries = manifest.getJSONArray("blocks");
                if (entries.length() < 1 || entries.length() > 150000) throw new IOException("差量分块数量无效");
                List<ApkDelta.Block> blocks = new ArrayList<>(); long offset = 0;
                for (int i = 0; i < entries.length(); i++) {
                    JSONObject entry = entries.getJSONObject(i); int n = entry.getInt("size");
                    byte[] inline = entry.has("data") ? android.util.Base64.decode(entry.getString("data"), android.util.Base64.DEFAULT) : null;
                    blocks.add(new ApkDelta.Block(offset, n, entry.getString("sha256"), inline)); offset += n;
                }
                File directory = new File(getContext().getCacheDir(), "cyword-updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建更新目录");
                File target = new File(directory, hash + ".apk");
                // Keep the same target for verified resume; remove only our obsolete update files.
                File[] stale = directory.listFiles();
                if (stale != null) for (File file : stale) if (file.isFile() && file.getName().matches("[a-f0-9]{64}\\.apk") && !file.equals(target)) file.delete();
                if (directory.getUsableSpace() < Math.max(0, size - target.length()) + 32 * 1024 * 1024) throw new IOException("存储空间不足，请腾出约 " + ((size + 1048575) / 1048576) + " MB 后重试");
                long downloaded = ApkDelta.rebuild(new File(getContext().getApplicationInfo().sourceDir), target, blocks, size, hash,
                    (start, length) -> UpdateTransport.read(url, length, start, size), this::progress);
                verifyPackage(target, version);
                prepared = target; preparedHash = hash; preparedVersion = version;
                JSObject result = new JSObject(); result.put("downloadedBytes", downloaded + mapSize); result.put("sizeBytes", size); call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage() == null ? "更新失败，请重试" : error.getMessage(), error); }
            finally { busy.set(false); }
        });
    }
    private void verifyPackage(File file, String version) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo next = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), flags);
        if (next == null || !current.packageName.equals(next.packageName) || !version.equals(next.versionName) || (Build.VERSION.SDK_INT >= 28 ? next.getLongVersionCode() <= current.getLongVersionCode() : next.versionCode <= current.versionCode)) throw new IOException("新版安装包身份或版本无效");
        Set<String> installed = new HashSet<>(), update = new HashSet<>();
        Signature[] oldSigners = Build.VERSION.SDK_INT >= 28 ? current.signingInfo == null ? null : current.signingInfo.getApkContentsSigners() : current.signatures;
        Signature[] newSigners = Build.VERSION.SDK_INT >= 28 ? next.signingInfo == null ? null : next.signingInfo.getApkContentsSigners() : next.signatures;
        if (oldSigners == null || newSigners == null) throw new IOException("安装包签名缺失");
        for (Signature cert : oldSigners) installed.add(ApkDelta.hash(cert.toByteArray()));
        for (Signature cert : newSigners) update.add(ApkDelta.hash(cert.toByteArray()));
        if (installed.isEmpty() || !installed.equals(update)) throw new IOException("安装包签名与当前应用不一致");
    }
    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("更新正在进行"); return; }
        worker.execute(() -> {
            try {
                File file = prepared;
                if (file == null || !file.isFile() || !ApkDelta.fileHash(file).equals(preparedHash)) throw new IOException("请先下载新版");
                verifyPackage(file, preparedVersion);
                getActivity().runOnUiThread(() -> {
                    try {
                        JSObject result = new JSObject();
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                            result.put("permissionRequired", true);
                        } else {
                            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(intent); result.put("permissionRequired", false);
                        }
                        call.resolve(result);
                    } catch (Exception error) { call.reject("无法打开系统安装，请重试", error); }
                    finally { busy.set(false); }
                });
            } catch (Exception error) { prepared = null; busy.set(false); call.reject(error.getMessage(), "UPDATE_NOT_READY", error); }
        });
    }
    @PluginMethod
    public void openDownload(PluginCall call) {
        String url = call.getString("url", "");
        // Only the immutable APK URL from our Android release protocol can leave the app.
        if (!validUrl(url)) {
            call.reject("下载地址无效");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException error) {
                call.reject("无法打开浏览器，请安装或启用浏览器", error);
            }
        });
    }
}
