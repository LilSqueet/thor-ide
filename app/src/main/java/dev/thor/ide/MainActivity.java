package dev.thor.ide;

import android.app.Activity;
import android.app.Presentation;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * Thor IDE: an on-device dual-screen development environment for the AYN Thor.
 *
 * Screens:
 *   - "main"   : this Activity's window (the Thor's top screen, display 0).
 *   - "second" : a Presentation on the first presentation-category display (the bottom screen).
 *
 * Each screen owns exactly one WebView. The IDE assigns a ROLE to each WebView:
 *   - EDITOR : the bundled editor UI (assets/editor/index.html)
 *   - TOP    : the project's index.html
 *   - BOTTOM : the project's bottom.html (dual-screen projects)
 *
 * Modes:
 *   - EDIT : editor on one screen, live preview (index.html) on the other.
 *   - RUN  : index.html on the top screen, bottom.html on the bottom screen (full dual-screen run).
 *            A floating button / the Back key returns to EDIT.
 *
 * If no second display exists, the Activity shows a stacked editor + preview on the single screen.
 */
public class MainActivity extends Activity {

    static final String TAG = "ThorIDE";
    static final String EDITOR_URL = "file:///android_asset/editor/index.html";

    enum Role { EDITOR, TOP, BOTTOM, NONE }
    enum Mode { EDIT, RUN }

    private final Handler ui = new Handler(Looper.getMainLooper());

    private DisplayManager displayManager;
    private ProjectStore store;

    // Main-screen views
    private LinearLayout mainRoot;
    private WebView mainWeb;          // always present
    private WebView mainWebSecondary; // only used in single-screen fallback
    private Button backToEditorBtn;

    // Second-screen views
    private SecondScreen second;
    private WebView secondWeb;

    private Mode mode = Mode.EDIT;
    private boolean editorOnMain = false; // false = editor on the bottom screen (default)
    private String currentProject = null;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        store = new ProjectStore(new File(getExternalFilesDir(null), "projects"));
        store.ensureSamples(getAssets());

        if (savedInstanceState != null) {
            currentProject = savedInstanceState.getString("project");
            editorOnMain = savedInstanceState.getBoolean("editorOnMain", false);
        }
        if (currentProject == null) currentProject = store.firstProjectName();

        mainRoot = new LinearLayout(this);
        mainRoot.setOrientation(LinearLayout.VERTICAL);
        mainRoot.setBackgroundColor(Color.BLACK);

        mainWeb = buildWebView(this, "main");
        mainWebSecondary = buildWebView(this, "main2");
        mainRoot.addView(mainWeb, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        mainRoot.addView(mainWebSecondary, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        mainWebSecondary.setVisibility(View.GONE);

        FrameLayout overlay = new FrameLayout(this);
        overlay.addView(mainRoot, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        backToEditorBtn = new Button(this);
        backToEditorBtn.setText("◀ Editor");
        backToEditorBtn.setAlpha(0.75f);
        backToEditorBtn.setVisibility(View.GONE);
        backToEditorBtn.setOnClickListener(v -> setMode(Mode.EDIT));
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        blp.gravity = Gravity.TOP | Gravity.END;
        blp.setMargins(0, 8, 8, 0);
        overlay.addView(backToEditorBtn, blp);

        setContentView(overlay);

        displayManager.registerDisplayListener(displayListener, ui);
    }

    @Override
    protected void onResume() {
        super.onResume();
        attachSecondScreen();
        applyRoles();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep the presentation alive across pause so flipping between screens doesn't flicker;
        // it is torn down in onDestroy.
    }

    @Override
    protected void onDestroy() {
        displayManager.unregisterDisplayListener(displayListener);
        detachSecondScreen();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("project", currentProject);
        out.putBoolean("editorOnMain", editorOnMain);
    }

    // ------------------------------------------------------------------ media import (photos, GIFs, videos)

    static final int REQ_IMPORT_MEDIA = 41;

    void startMediaImport() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        try { startActivityForResult(i, REQ_IMPORT_MEDIA); }
        catch (Exception e) {
            android.widget.Toast.makeText(this, "No file picker available", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_IMPORT_MEDIA || res != RESULT_OK || data == null || data.getData() == null || currentProject == null) return;
        Uri uri = data.getData();
        String name = "media";
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0 && c.getString(idx) != null) name = c.getString(idx);
            }
        } catch (Exception ignored) {}
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.isEmpty() || name.startsWith(".")) name = "media_" + System.currentTimeMillis();
        final String path = "media/" + name;
        final String proj = currentProject;
        new Thread(() -> {
            boolean ok = false;
            try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
                ok = in != null && store.writeStream(proj, path, in);
            } catch (Exception ignored) {}
            final boolean fok = ok;
            ui.post(() -> {
                JSONObject o = new JSONObject();
                try { o.put("ok", fok); o.put("path", path); } catch (Exception ignored) {}
                evalOnEditor("window.ThorEvents && ThorEvents.emit('imported', " + o + ")");
            });
        }).start();
    }

    @Override
    public void onBackPressed() {
        if (mode == Mode.RUN) {
            setMode(Mode.EDIT);
            return;
        }
        // In EDIT mode the Back key is swallowed so an accidental press doesn't kill the IDE.
        evalOnEditor("window.ThorEvents && ThorEvents.emit('back')");
    }

    // ------------------------------------------------------------------ controller → JS
    // The Thor's built-in pad arrives as gamepad KeyEvents / joystick MotionEvents on the focused
    // window (this Activity). They are forwarded to every WebView as window.ThorInput calls; the
    // game engine and the editor both implement ThorInput.

    static String buttonName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return "A";
            case KeyEvent.KEYCODE_BUTTON_B: return "B";
            case KeyEvent.KEYCODE_BUTTON_X: return "X";
            case KeyEvent.KEYCODE_BUTTON_Y: return "Y";
            case KeyEvent.KEYCODE_BUTTON_L1: return "L1";
            case KeyEvent.KEYCODE_BUTTON_R1: return "R1";
            case KeyEvent.KEYCODE_BUTTON_L2: return "L2";
            case KeyEvent.KEYCODE_BUTTON_R2: return "R2";
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return "L3";
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return "R3";
            case KeyEvent.KEYCODE_BUTTON_START: return "START";
            case KeyEvent.KEYCODE_BUTTON_SELECT: return "SELECT";
            case KeyEvent.KEYCODE_DPAD_UP: return "UP";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "DOWN";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "LEFT";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "RIGHT";
            case KeyEvent.KEYCODE_DPAD_CENTER: return "A";
            default: return null;
        }
    }

    /** Returns true when the event was consumed as a controller button. */
    boolean handleControllerKey(KeyEvent e) {
        String name = buttonName(e.getKeyCode());
        if (name == null) return false;
        if (e.getRepeatCount() > 0) return true; // we track held state in JS; drop auto-repeats
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        if (!down && e.getAction() != KeyEvent.ACTION_UP) return true;
        String js = "window.ThorInput && ThorInput.button(" + JSONObject.quote(name) + "," + down + ")";
        broadcast(js);
        return true;
    }

    private float lastLx, lastLy, lastRx, lastRy, lastHx, lastHy;

    boolean handleControllerMotion(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK
                && (e.getSource() & InputDevice.SOURCE_GAMEPAD) != InputDevice.SOURCE_GAMEPAD) return false;
        if (e.getAction() != MotionEvent.ACTION_MOVE) return false;
        float lx = dz(e.getAxisValue(MotionEvent.AXIS_X)), ly = dz(e.getAxisValue(MotionEvent.AXIS_Y));
        float rx = dz(e.getAxisValue(MotionEvent.AXIS_Z)), ry = dz(e.getAxisValue(MotionEvent.AXIS_RZ));
        float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
        if (lx != lastLx || ly != lastLy || rx != lastRx || ry != lastRy) {
            lastLx = lx; lastLy = ly; lastRx = rx; lastRy = ry;
            broadcast("window.ThorInput && ThorInput.axes(" + lx + "," + ly + "," + rx + "," + ry + ")");
        }
        // D-pad reported as a hat switch on some controllers → synthesize button events.
        if (hx != lastHx) { hatButton("LEFT", lastHx < -0.5f, hx < -0.5f); hatButton("RIGHT", lastHx > 0.5f, hx > 0.5f); lastHx = hx; }
        if (hy != lastHy) { hatButton("UP", lastHy < -0.5f, hy < -0.5f); hatButton("DOWN", lastHy > 0.5f, hy > 0.5f); lastHy = hy; }
        return true;
    }
    private void hatButton(String name, boolean was, boolean is) {
        if (was == is) return;
        broadcast("window.ThorInput && ThorInput.button(" + JSONObject.quote(name) + "," + is + ")");
    }
    private static float dz(float v) { return Math.abs(v) < 0.12f ? 0f : v; }

    /** Runs JS in every live WebView (editor and both game screens). */
    void broadcast(String js) {
        for (WebView w : new WebView[]{mainWeb, mainWebSecondary, secondWeb}) {
            if (w != null && w.getVisibility() == View.VISIBLE && w.getTag(R_ROLE) != Role.NONE) {
                try { w.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        // BACK is handled by onBackPressed; everything that looks like a pad button goes to JS.
        if (e.getKeyCode() != KeyEvent.KEYCODE_BACK && handleControllerKey(e)) return true;
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (handleControllerMotion(e)) return true;
        return super.dispatchGenericMotionEvent(e);
    }

    // ------------------------------------------------------------------ displays

    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId)   { ui.post(() -> { attachSecondScreen(); applyRoles(); }); }
        @Override public void onDisplayRemoved(int displayId) { ui.post(() -> { detachSecondScreen(); applyRoles(); }); }
        @Override public void onDisplayChanged(int displayId) {
            Display d = displayManager.getDisplay(displayId);
            if (d != null && d.getState() == Display.STATE_OFF && second != null
                    && second.getDisplay().getDisplayId() == displayId) {
                ui.post(() -> { detachSecondScreen(); applyRoles(); });
            }
        }
    };

    /** The Thor's bottom screen reports itself as a presentation-category display. */
    private Display findSecondDisplay() {
        Display[] pres = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        for (Display d : pres) if (d.getState() != Display.STATE_OFF) return d;
        for (Display d : displayManager.getDisplays()) {
            if (d.getDisplayId() != Display.DEFAULT_DISPLAY && d.getState() != Display.STATE_OFF) return d;
        }
        return null;
    }

    private void attachSecondScreen() {
        if (second != null && second.isShowing()) return;
        Display d = findSecondDisplay();
        if (d == null) return;
        try {
            second = new SecondScreen(this, d);
            secondWeb = buildWebView(second.getContext(), "second");
            second.setWebView(secondWeb);
            second.show();
        } catch (Exception e) {
            android.util.Log.w(TAG, "Could not show second screen", e);
            second = null;
            secondWeb = null;
        }
    }

    private void detachSecondScreen() {
        if (second != null) {
            try { second.dismiss(); } catch (Exception ignored) {}
        }
        if (secondWeb != null) {
            try { secondWeb.destroy(); } catch (Exception ignored) {}
        }
        second = null;
        secondWeb = null;
    }

    private boolean hasSecondScreen() {
        return second != null && secondWeb != null;
    }

    // ------------------------------------------------------------------ roles / modes

    private void setMode(Mode m) {
        mode = m;
        applyRoles();
    }

    /** Assigns which content each WebView shows, based on mode / swap / screen count. */
    private void applyRoles() {
        backToEditorBtn.setVisibility(mode == Mode.RUN ? View.VISIBLE : View.GONE);

        if (hasSecondScreen()) {
            mainWebSecondary.setVisibility(View.GONE);
            if (mode == Mode.RUN) {
                load(mainWeb, Role.TOP);
                load(secondWeb, Role.BOTTOM);
            } else if (editorOnMain) {
                load(mainWeb, Role.EDITOR);
                load(secondWeb, Role.TOP);
            } else {
                load(secondWeb, Role.EDITOR);
                load(mainWeb, Role.TOP);
            }
        } else {
            // Single-screen fallback: stack editor and preview.
            if (mode == Mode.RUN) {
                mainWebSecondary.setVisibility(View.VISIBLE);
                load(mainWeb, Role.TOP);
                load(mainWebSecondary, Role.BOTTOM);
            } else {
                mainWebSecondary.setVisibility(View.VISIBLE);
                load(mainWeb, Role.TOP);
                load(mainWebSecondary, Role.EDITOR);
            }
        }
    }

    private void load(WebView w, Role role) {
        Role prev = (Role) w.getTag(R_ROLE);
        String url;
        switch (role) {
            case EDITOR: url = EDITOR_URL; break;
            case TOP:    url = projectUrl("index.html"); break;
            case BOTTOM: url = projectUrl("bottom.html"); break;
            default:     url = "about:blank";
        }
        // Avoid reloading the editor (would lose unsaved edits) if it's already there.
        if (prev == role && role == Role.EDITOR && !"about:blank".equals(w.getUrl()) && w.getUrl() != null) {
            evalOnEditor("window.ThorEvents && ThorEvents.emit('screens', " + screensJson() + ")");
            return;
        }
        w.setTag(R_ROLE, role);
        w.loadUrl(url);
    }

    private static final int R_ROLE = R.id.thor_role;

    private String projectUrl(String file) {
        if (currentProject == null) return "about:blank";
        File f = store.file(currentProject, file);
        if (!f.exists()) {
            return "data:text/html;charset=utf-8," + android.net.Uri.encode(
                    "<html><body style='background:#111;color:#aaa;font-family:sans-serif;padding:24px'>"
                    + "<h3>" + file + " not found in project \"" + currentProject + "\"</h3>"
                    + "<p>Create it in the editor and press Run.</p></body></html>");
        }
        return "file://" + f.getAbsolutePath() + "?t=" + System.currentTimeMillis();
    }

    private WebView editorWeb() {
        if (hasSecondScreen()) {
            if (mode == Mode.EDIT) return editorOnMain ? mainWeb : secondWeb;
            return null;
        }
        return mode == Mode.EDIT ? mainWebSecondary : null;
    }

    private WebView webFor(Role r) {
        for (WebView w : new WebView[]{mainWeb, mainWebSecondary, secondWeb}) {
            if (w != null && w.getTag(R_ROLE) == r && w.getVisibility() == View.VISIBLE) return w;
        }
        return null;
    }

    private void evalOnEditor(String js) {
        WebView e = editorWeb();
        if (e != null) e.evaluateJavascript(js, null);
    }

    private String screensJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("dual", hasSecondScreen());
            o.put("editorOnMain", editorOnMain);
            o.put("mode", mode.name());
            o.put("project", currentProject);
            if (second != null) {
                Display d = second.getDisplay();
                o.put("secondDisplayId", d.getDisplayId());
                o.put("secondDisplayName", d.getName());
            }
        } catch (Exception ignored) {}
        return o.toString();
    }

    // ------------------------------------------------------------------ webviews

    private WebView buildWebView(Context ctx, String name) {
        WebView w = new WebView(ctx);
        w.setBackgroundColor(Color.BLACK);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        w.addJavascriptInterface(new IdeBridge(), "ThorIDE");
        w.addJavascriptInterface(new ScreenBridge(w), "ThorNative");
        w.setWebViewClient(new WebViewClient());
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Role r = (Role) w.getTag(R_ROLE);
                if (r != null && r != Role.EDITOR) {
                    JSONObject o = new JSONObject();
                    try {
                        o.put("level", m.messageLevel().name().toLowerCase());
                        o.put("screen", r == Role.TOP ? "top" : "bottom");
                        o.put("msg", m.message());
                        o.put("line", m.lineNumber());
                        o.put("src", m.sourceId() == null ? "" : new File(m.sourceId()).getName());
                    } catch (Exception ignored) {}
                    ui.post(() -> evalOnEditor("window.ThorEvents && ThorEvents.emit('console', " + o + ")"));
                }
                return true;
            }
        });
        w.setTag(R_ROLE, Role.NONE);
        return w;
    }

    // ------------------------------------------------------------------ export as a standalone app

    File exportsDir() { File d = new File(getExternalFilesDir(null), "exports"); if (!d.exists()) d.mkdirs(); return d; }

    private byte[] assetBytes(String path) {
        try (java.io.InputStream in = getAssets().open(path)) { return ApkExporter.readAll(in); }
        catch (Exception e) { return new byte[0]; }
    }

    void exportProject(String project, String label) {
        new Thread(() -> {
            JSONObject o = new JSONObject();
            try {
                byte[] tpl = assetBytes("player.apk"), key = assetBytes("signing/key.pk8"), cert = assetBytes("signing/cert.der");
                if (tpl.length == 0 || key.length == 0 || cert.length == 0)
                    throw new java.io.IOException("this build has no game player / signing key bundled");
                String slug = ApkExporter.slug(project);
                String name = (label == null || label.trim().isEmpty()) ? project : label.trim();
                File out = new File(exportsDir(), slug + ".apk");
                ApkExporter.export(tpl, ApkExporter.collectProject(new File(store.root(), project)), "dev.thor.game." + slug, name, key, cert, out);
                o.put("ok", true); o.put("path", out.getName()); o.put("size", out.length());
                o.put("downloads", copyToDownloads(out, slug + ".apk"));
            } catch (Exception e) {
                try { o.put("ok", false); o.put("error", String.valueOf(e.getMessage() == null ? e : e.getMessage())); } catch (Exception ignored) {}
            }
            ui.post(() -> evalOnEditor("window.ThorEvents && ThorEvents.emit('exported', " + o + ")"));
        }).start();
    }

    /** Also drops a copy in Download/ThorGames so it can be found with a file manager / USB. */
    private String copyToDownloads(File f, String name) {
        try {
            android.content.ContentResolver cr = getContentResolver();
            String rel = android.os.Environment.DIRECTORY_DOWNLOADS + "/ThorGames/";
            Uri coll = android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            try { cr.delete(coll, android.provider.MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + android.provider.MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[]{name, rel}); } catch (Exception ignored) {}
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/vnd.android.package-archive");
            v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, rel);
            Uri uri = cr.insert(coll, v);
            if (uri == null) return "";
            try (java.io.OutputStream out = cr.openOutputStream(uri); java.io.InputStream in = new java.io.FileInputStream(f)) {
                byte[] buf = new byte[65536]; int r;
                while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
            }
            return rel + name;
        } catch (Exception e) { return ""; }
    }

    void installExported(String name) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse("content://" + ExportProvider.AUTHORITY + "/" + Uri.encode(name)), "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "Could not open the installer: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
        }
    }

    // ------------------------------------------------------------------ JS bridge: IDE API (used by the editor)

    public class IdeBridge {
        @JavascriptInterface public String listProjects()                    { return store.listProjects().toString(); }
        @JavascriptInterface public String listFiles(String project)         { return store.listFiles(project).toString(); }
        @JavascriptInterface public String readFile(String project, String path) {
            String s = store.read(project, path);
            return s == null ? "" : s;
        }
        @JavascriptInterface public boolean fileExists(String project, String path) { return store.file(project, path).exists(); }
        @JavascriptInterface public boolean writeFile(String project, String path, String content) { return store.write(project, path, content); }
        @JavascriptInterface public boolean deleteFile(String project, String path) { return store.delete(project, path); }
        @JavascriptInterface public boolean renameFile(String project, String from, String to) { return store.rename(project, from, to); }
        @JavascriptInterface public boolean createProject(String name, String template) {
            boolean ok = store.createProject(name, template, getAssets());
            if (ok) { currentProject = name; }
            return ok;
        }
        @JavascriptInterface public boolean deleteProject(String name) {
            boolean ok = store.deleteProject(name);
            if (ok && name.equals(currentProject)) currentProject = store.firstProjectName();
            return ok;
        }
        @JavascriptInterface public String currentProject() { return currentProject == null ? "" : currentProject; }
        @JavascriptInterface public void setProject(String name) {
            currentProject = name;
            ui.post(() -> {
                // reload preview only
                WebView t = webFor(Role.TOP);
                if (t != null) load(t, Role.TOP);
            });
        }
        @JavascriptInterface public String screens() { return screensJson(); }
        @JavascriptInterface public String projectsDir() { return store.root().getAbsolutePath(); }
        /** Opens the system picker for a photo / GIF / video; result arrives as ThorEvents 'imported'. */
        @JavascriptInterface public void importMedia() { ui.post(MainActivity.this::startMediaImport); }
        /** URL the editor can use to show a project file (thumbnails). */
        @JavascriptInterface public String fileUrl(String project, String path) { return "file://" + store.file(project, path).getAbsolutePath(); }
        /** Read a bundled asset (e.g. "engine/engine.js") as text; "" when missing. */
        @JavascriptInterface public String readAsset(String path) {
            try (java.io.InputStream in = getAssets().open(path)) {
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int r;
                while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
                return new String(bo.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception e) { return ""; }
        }

        /** Builds an installable APK of a project (background). Result arrives as ThorEvents 'exported'. */
        @JavascriptInterface public void exportApk(String project, String label) { exportProject(project, label); }
        /** Hands an exported APK (file name from 'exported'.path) to the Android package installer. */
        @JavascriptInterface public void installApk(String name) { ui.post(() -> installExported(name)); }
        /** True when this build bundles the game player + signing key. */
        @JavascriptInterface public boolean canExport() {
            try { getAssets().open("player.apk").close(); getAssets().open("signing/key.pk8").close(); return true; }
            catch (Exception e) { return false; }
        }

        /** Reload the preview (index.html) on the other screen. */
        @JavascriptInterface public void run() {
            ui.post(() -> {
                WebView t = webFor(Role.TOP);
                if (t != null) { t.setTag(R_ROLE, Role.NONE); load(t, Role.TOP); }
                else applyRoles();
            });
        }
        /** Full dual-screen run: index.html on top, bottom.html on bottom. */
        @JavascriptInterface public void runDual() { ui.post(() -> setMode(Mode.RUN)); }
        @JavascriptInterface public void stop()    { ui.post(() -> setMode(Mode.EDIT)); }
        /** Put the editor on the top (main) screen instead of the bottom. Useful because the Android keyboard appears on the main screen. */
        @JavascriptInterface public void swapScreens() {
            ui.post(() -> {
                editorOnMain = !editorOnMain;
                // Force both webviews to reassign.
                if (mainWeb != null) mainWeb.setTag(R_ROLE, Role.NONE);
                if (secondWeb != null) secondWeb.setTag(R_ROLE, Role.NONE);
                applyRoles();
            });
        }
        @JavascriptInterface public void toast(String msg) {
            ui.post(() -> android.widget.Toast.makeText(MainActivity.this, msg, android.widget.Toast.LENGTH_SHORT).show());
        }
        /** Evaluate JS inside the running preview (top screen). Result is delivered via ThorEvents 'evalResult'. */
        @JavascriptInterface public void evalInPreview(String js) {
            ui.post(() -> {
                WebView t = webFor(Role.TOP);
                if (t == null) return;
                t.evaluateJavascript(js, v -> evalOnEditor(
                        "window.ThorEvents && ThorEvents.emit('evalResult', " + JSONObject.quote(v == null ? "undefined" : v) + ")"));
            });
        }
    }

    // ------------------------------------------------------------------ JS bridge: screen-to-screen messaging (used by user apps)

    /**
     * Available to user apps as window.ThorNative:
     *   ThorNative.screen()        -> "top" | "bottom" | "editor"
     *   ThorNative.send(jsonText)  -> delivered to the OTHER screen as window.onThorMessage(obj)
     *   ThorNative.isDual()        -> true when a second display is attached
     */
    public class ScreenBridge {
        private final WebView self;
        ScreenBridge(WebView self) { this.self = self; }

        @JavascriptInterface public String screen() {
            Role r = (Role) self.getTag(R_ROLE);
            if (r == Role.TOP) return "top";
            if (r == Role.BOTTOM) return "bottom";
            if (r == Role.EDITOR) return "editor";
            return "none";
        }
        /** True only while both screens are running the app (RUN mode); in EDIT mode the other screen is the editor. */
        @JavascriptInterface public boolean isDual() { return hasSecondScreen() && mode == Mode.RUN; }
        @JavascriptInterface public void send(String json) {
            ui.post(() -> {
                Role r = (Role) self.getTag(R_ROLE);
                Role target = (r == Role.TOP) ? Role.BOTTOM : Role.TOP;
                WebView t = webFor(target);
                if (t != null) {
                    t.evaluateJavascript("window.onThorMessage && window.onThorMessage(" + json + ")", null);
                }
                // Also mirror to the editor console so the developer can watch traffic.
                JSONObject o = new JSONObject();
                try {
                    o.put("level", "msg");
                    o.put("screen", r == Role.TOP ? "top" : "bottom");
                    o.put("msg", json);
                } catch (Exception ignored) {}
                evalOnEditor("window.ThorEvents && ThorEvents.emit('console', " + o + ")");
            });
        }
    }

    // ------------------------------------------------------------------ Presentation

    class SecondScreen extends Presentation {
        private WebView web;
        SecondScreen(Context outer, Display d) { super(outer, d); }
        @Override public boolean dispatchKeyEvent(KeyEvent e) {
            if (e.getKeyCode() != KeyEvent.KEYCODE_BACK && handleControllerKey(e)) return true;
            if (e.getKeyCode() == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) { onBackPressed(); return true; }
            return super.dispatchKeyEvent(e);
        }
        @Override public boolean dispatchGenericMotionEvent(MotionEvent e) {
            if (handleControllerMotion(e)) return true;
            return super.dispatchGenericMotionEvent(e);
        }
        void setWebView(WebView w) { this.web = w; }

        @Override
        protected void onCreate(Bundle b) {
            super.onCreate(b);
            Window win = getWindow();
            if (win != null) {
                win.setBackgroundDrawableResource(android.R.color.black);
                win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            FrameLayout root = new FrameLayout(getContext());
            root.setBackgroundColor(Color.BLACK);
            if (web != null) root.addView(web, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setContentView(root);
        }
    }
}
