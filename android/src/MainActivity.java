package io.github.chenhenry0429.pausebeforescroll;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "chenhenry0429.github.io";
    private static final String ROOT = "/pause-before-scroll/";
    private static final String URL = "https://" + HOST + ROOT;
    private static final String WORKER = "pause-mobile-reminders.chenhenry860.workers.dev";
    private static final String CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        + "connect-src https://" + WORKER + "; img-src 'self'; manifest-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    private static final int NOTIFICATIONS = 10, EXPORT = 11;
    private WebView web;
    private volatile Uri exportSource;

    private static String mime(String name) {
        switch (name) {
            case "index.html": return "text/html";
            case "app-compat.js": return "application/javascript";
            case "style.css": return "text/css";
            case "icon.svg": return "image/svg+xml";
            case "manifest.webmanifest": return "application/manifest+json";
            case "icon-192.png":
            case "icon-512.png":
            case "apple-touch-icon.png": return "image/png";
            default: return null;
        }
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LocalReminders.createChannel(this);
        getWindow().setStatusBarColor(0xff355b48);
        getWindow().setNavigationBarColor(0xff355b48);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(), "PauseAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if (!request.isForMainFrame() && httpsHost(uri, WORKER)
                    && ("/api/feedback".equals(path) || "/api/feedback/token".equals(path))) return null;
                if ("GET".equals(request.getMethod()) && httpsHost(uri, HOST) && path != null && path.startsWith(ROOT)) {
                    String name = path.substring(ROOT.length());
                    if (name.isEmpty()) name = "index.html";
                    String contentType = mime(name);
                    if (contentType != null && (!request.isForMainFrame() || name.equals("index.html"))) {
                        try {
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Content-Security-Policy", CSP);
                            headers.put("Cache-Control", "no-store");
                            return new WebResourceResponse(contentType, "UTF-8", 200, "OK",
                                headers, getAssets().open("www/" + name));
                        } catch (IOException missed) { return blocked(); }
                    }
                }
                return blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return true;
                if (httpsHost(uri, HOST) && (ROOT.equals(uri.getPath()) || (ROOT + "index.html").equals(uri.getPath()))) return false;
                if ("https".equals(uri.getScheme()) && uri.getUserInfo() == null) openOutside(uri);
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(URL);
    }

    private static boolean httpsHost(Uri uri, String host) {
        return "https".equals(uri.getScheme()) && host.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private void openOutside(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException missing) { Toast.makeText(this, "没有可打开链接的浏览器。", Toast.LENGTH_SHORT).show(); }
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('pause-android-resume'))", null);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == NOTIFICATIONS && web != null)
            web.evaluateJavascript("window.dispatchEvent(new Event('pause-android-resume'))", null);
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != EXPORT || result != RESULT_OK || data == null || data.getData() == null) return;
        exportSource = data.getData();
        web.evaluateJavascript("window.pauseAndroidSaveExport && window.pauseAndroidSaveExport()", null);
    }

    @Override protected void onDestroy() {
        web.removeJavascriptInterface("PauseAndroid");
        web.destroy();
        super.onDestroy();
    }

    private final class Bridge {
        @JavascriptInterface public String status() { return LocalReminders.status(MainActivity.this).toString(); }

        @JavascriptInterface public String schedule(String id, double due) {
            return LocalReminders.schedule(MainActivity.this, false, id, (long) due).toString();
        }

        @JavascriptInterface public void cancel(String id) { LocalReminders.cancel(MainActivity.this, false, id); }

        @JavascriptInterface public String test() {
            return LocalReminders.schedule(MainActivity.this, true, java.util.UUID.randomUUID().toString(),
                System.currentTimeMillis() + 10_000).toString();
        }

        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(() -> {
                if (LocalReminders.canNotify(MainActivity.this)) return;
                LocalReminders.state(MainActivity.this).edit().putBoolean("asked", true).apply();
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        && !LocalReminders.state(MainActivity.this).getBoolean("requested", false)) {
                    LocalReminders.state(MainActivity.this).edit().putBoolean("requested", true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
                } else {
                    startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                }
            });
        }

        @JavascriptInterface public void requestExactAlarm() {
            runOnUiThread(() -> {
                if (!LocalReminders.exactAllowed(MainActivity.this)) {
                    try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + getPackageName()))); }
                    catch (ActivityNotFoundException missing) {
                        Toast.makeText(MainActivity.this, "找不到闹钟权限设置，可继续使用普通提醒。", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface public void exportRecords() {
            runOnUiThread(() -> {
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
                    .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "pause-before-scroll-records.json");
                try { startActivityForResult(create, EXPORT); }
                catch (ActivityNotFoundException missing) { Toast.makeText(MainActivity.this, "未找到可用于保存文件的应用。", Toast.LENGTH_LONG).show(); }
            });
        }

        @JavascriptInterface public boolean writeExport(String json) {
            Uri destination = exportSource;
            exportSource = null;
            if (destination == null || json == null || json.length() > 2_000_000) return false;
            try (OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
                if (out == null) return false;
                out.write(json.getBytes(StandardCharsets.UTF_8));
                return true;
            } catch (IOException | SecurityException failed) { return false; }
        }
    }
}
