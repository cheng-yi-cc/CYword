package me.chengyi.cyword;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceStoragePlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        // Only the separate acceptance package exposes WebView debugging to ADB.
        if (BuildConfig.APPLICATION_ID.endsWith(".acceptance")) android.webkit.WebView.setWebContentsDebuggingEnabled(true);
    }
}
