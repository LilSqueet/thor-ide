package dev.thor.player;

import android.app.Activity;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Standalone runtime for a game exported from Thor IDE.
 *   top screen    -> file:///android_asset/game/index.html
 *   bottom screen -> file:///android_asset/game/bottom.html (when a second display exists)
 * Same window.ThorNative / window.ThorInput contract as the IDE, so generated games run unchanged.
 */
public class MainActivity extends Activity {

    static final String TOP_URL = "file:///android_asset/game/index.html";
    static final String BOTTOM_URL = "file:///android_asset/game/bottom.html";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private DisplayManager displayManager;
    private WebView topWeb, bottomWeb;
    private SecondScreen second;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        topWeb = build(this, "top");
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(topWeb, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        topWeb.loadUrl(TOP_URL);
        displayManager.registerDisplayListener(listener, ui);
    }

    @Override protected void onResume() { super.onResume(); attachSecond(); }
    @Override protected void onDestroy() { displayManager.unregisterDisplayListener(listener); detachSecond(); super.onDestroy(); }

    private final DisplayManager.DisplayListener listener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int id) { ui.post(MainActivity.this::attachSecond); }
        @Override public void onDisplayRemoved(int id) { ui.post(MainActivity.this::detachSecond); }
        @Override public void onDisplayChanged(int id) {}
    };

    private Display findSecondDisplay() {
        for (Display d : displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)) if (d.getState() != Display.STATE_OFF) return d;
        for (Display d : displayManager.getDisplays()) if (d.getDisplayId() != Display.DEFAULT_DISPLAY && d.getState() != Display.STATE_OFF) return d;
        return null;
    }

    private void attachSecond() {
        if (second != null && second.isShowing()) return;
        Display d = findSecondDisplay();
        if (d == null) return;
        try {
            second = new SecondScreen(this, d);
            bottomWeb = build(second.getContext(), "bottom");
            second.setWebView(bottomWeb);
            second.show();
            bottomWeb.loadUrl(BOTTOM_URL); // the bottom page asks the top for a state snapshot once it has loaded
        } catch (Exception e) { second = null; bottomWeb = null; }
    }

    private void detachSecond() {
        if (second != null) { try { second.dismiss(); } catch (Exception ignored) {} }
        if (bottomWeb != null) { try { bottomWeb.destroy(); } catch (Exception ignored) {} }
        second = null; bottomWeb = null;
    }

    private boolean dual() { return second != null && bottomWeb != null; }

    private WebView build(Context ctx, String role) {
        WebView w = new WebView(ctx);
        w.setBackgroundColor(Color.BLACK);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        w.setTag(role);
        w.addJavascriptInterface(new Bridge(w), "ThorNative");
        w.setWebViewClient(new WebViewClient());
        w.setWebChromeClient(new WebChromeClient());
        return w;
    }

    // ------------------------------------------------------------------ controller -> JS

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

    boolean handleKey(KeyEvent e) {
        String name = buttonName(e.getKeyCode());
        if (name == null) return false;
        if (e.getRepeatCount() > 0) return true;
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        if (!down && e.getAction() != KeyEvent.ACTION_UP) return true;
        broadcast("window.ThorInput && ThorInput.button(" + JSONObject.quote(name) + "," + down + ")");
        return true;
    }

    private float lastLx, lastLy, lastRx, lastRy, lastHx, lastHy;

    boolean handleMotion(MotionEvent e) {
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
        if (hx != lastHx) { hat("LEFT", lastHx < -0.5f, hx < -0.5f); hat("RIGHT", lastHx > 0.5f, hx > 0.5f); lastHx = hx; }
        if (hy != lastHy) { hat("UP", lastHy < -0.5f, hy < -0.5f); hat("DOWN", lastHy > 0.5f, hy > 0.5f); lastHy = hy; }
        return true;
    }
    private void hat(String name, boolean was, boolean is) { if (was != is) broadcast("window.ThorInput && ThorInput.button(" + JSONObject.quote(name) + "," + is + ")"); }
    private static float dz(float v) { return Math.abs(v) < 0.12f ? 0f : v; }

    void broadcast(String js) {
        for (WebView w : new WebView[]{topWeb, bottomWeb}) if (w != null) { try { w.evaluateJavascript(js, null); } catch (Exception ignored) {} }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() != KeyEvent.KEYCODE_BACK && handleKey(e)) return true;
        return super.dispatchKeyEvent(e);
    }
    @Override public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (handleMotion(e)) return true;
        return super.dispatchGenericMotionEvent(e);
    }

    // ------------------------------------------------------------------ screen-to-screen bridge

    public class Bridge {
        private final WebView self;
        Bridge(WebView self) { this.self = self; }
        @JavascriptInterface public String screen() { return String.valueOf(self.getTag()); }
        @JavascriptInterface public boolean isDual() { return dual(); }
        @JavascriptInterface public void send(String json) {
            ui.post(() -> {
                WebView t = self == topWeb ? bottomWeb : topWeb;
                if (t != null) t.evaluateJavascript("window.onThorMessage && window.onThorMessage(" + json + ")", null);
            });
        }
    }

    // ------------------------------------------------------------------ bottom screen

    class SecondScreen extends Presentation {
        private WebView web;
        SecondScreen(Context outer, Display d) { super(outer, d); }
        void setWebView(WebView w) { this.web = w; }
        @Override public boolean dispatchKeyEvent(KeyEvent e) {
            if (e.getKeyCode() != KeyEvent.KEYCODE_BACK && handleKey(e)) return true;
            if (e.getKeyCode() == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) { finish(); return true; }
            return super.dispatchKeyEvent(e);
        }
        @Override public boolean dispatchGenericMotionEvent(MotionEvent e) {
            if (handleMotion(e)) return true;
            return super.dispatchGenericMotionEvent(e);
        }
        @Override protected void onCreate(Bundle b) {
            super.onCreate(b);
            Window win = getWindow();
            if (win != null) {
                win.setBackgroundDrawableResource(android.R.color.black);
                win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            FrameLayout root = new FrameLayout(getContext());
            root.setBackgroundColor(Color.BLACK);
            if (web != null) root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setContentView(root);
        }
    }
}
