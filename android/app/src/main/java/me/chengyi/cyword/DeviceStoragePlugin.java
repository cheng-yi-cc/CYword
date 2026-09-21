package me.chengyi.cyword;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "DeviceStorage")
public class DeviceStoragePlugin extends Plugin {
    private static final String ALIAS = "me.chengyi.cyword.session.v1";
    private static final String SESSION = "cyword_session";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
    }
    private SharedPreferences credentials() {
        return getContext().getSharedPreferences("CywordCredentials", Context.MODE_PRIVATE);
    }
    private boolean persist(SharedPreferences store, String name, String value) {
        String previous = store.getString(name, null);
        SharedPreferences.Editor change = store.edit();
        if (value == null) change.remove(name); else change.putString(name, value);
        if (change.commit()) return true;
        // commit() changes Android's in-memory cache even when disk persistence fails.
        // Restore that cache so subsequent reads do not mistake the failed write for a save.
        SharedPreferences.Editor rollback = store.edit();
        if (previous == null) rollback.remove(name); else rollback.putString(name, previous);
        rollback.commit();
        return false;
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("系统凭据密钥不可用，请重新登录");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }
    private void writeEncrypted(String value) throws Exception {
        JSONObject session = new JSONObject(value);
        if (session.optString("token").isEmpty() || session.getJSONObject("user").optString("id").isEmpty()) {
            throw new IllegalArgumentException("用户会话格式无效");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        JSONObject encrypted = new JSONObject();
        encrypted.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        encrypted.put("ciphertext", Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!persist(credentials(), SESSION, encrypted.toString())) throw new IllegalStateException("凭据保存失败");
        // Only remove the old plaintext after encrypted persistence succeeded.
        if (!persist(preferences(), SESSION, null)) throw new IllegalStateException("旧凭据迁移未完成，请重试");
    }
    @PluginMethod
    public synchronized void readSession(PluginCall call) {
        try {
            String stored = credentials().getString(SESSION, null);
            String value = null;
            if (stored != null) {
                JSONObject encrypted = new JSONObject(stored);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(encrypted.getString("iv"), Base64.NO_WRAP)));
                value = new String(cipher.doFinal(Base64.decode(encrypted.getString("ciphertext"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
                if (!persist(preferences(), SESSION, null)) throw new IllegalStateException("旧凭据迁移未完成，请重试");
            } else {
                value = preferences().getString(SESSION, null);
                if (value != null) writeEncrypted(value);
            }
            JSObject result = new JSObject();
            result.put("value", value == null ? JSONObject.NULL : value);
            call.resolve(result);
        } catch (Exception error) { call.reject("读取受保护凭据失败，请重新登录", error); }
    }
    @PluginMethod
    public synchronized void writeSession(PluginCall call) {
        try { writeEncrypted(call.getString("value")); call.resolve(); }
        catch (Exception error) { call.reject("系统凭据保护或保存失败，请重试", error); }
    }
    @PluginMethod
    public synchronized void clearSession(PluginCall call) {
        if (!persist(preferences(), SESSION, null) || !persist(credentials(), SESSION, null)) {
            call.reject("清除凭据失败，请重试"); return;
        }
        call.resolve();
    }
    @PluginMethod
    public synchronized void writeProgress(PluginCall call) {
        String name = call.getString("key"), value = call.getString("value");
        if (name == null || !(name.startsWith("cyword-progress:") || name.startsWith("cyword-cloud-import:")) || value == null) { call.reject("进度格式无效"); return; }
        // Preferences.set uses apply(), which cannot report disk failures. Acknowledged
        // study saves use commit() so the UI advances only after durable persistence.
        if (!persist(preferences(), name, value)) { call.reject("设备进度保存失败，请检查存储空间"); return; }
        call.resolve();
    }
}
