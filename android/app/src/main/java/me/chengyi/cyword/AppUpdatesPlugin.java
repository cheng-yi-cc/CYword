package me.chengyi.cyword;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    @PluginMethod
    public void openDownload(PluginCall call) {
        String url = call.getString("url", "");
        // Only the immutable APK URL from our Android release protocol can leave the app.
        if (!url.matches("https://cyword\\.chengyi\\.me/downloads/releases/android/(\\d+\\.\\d+\\.\\d+)/[a-f0-9]{64}/CYword-Android-\\1\\.apk")) {
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
