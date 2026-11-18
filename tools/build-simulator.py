#!/usr/bin/env python3
"""Builds a browser simulator of Thor IDE (two fake screens + bridge shims) from the real
app assets, so the editor and templates can be tried without compiling the APK.
Output: sim/thor-ide-simulator.html (page content; published as an Artifact)."""
import base64, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
A = os.path.join(ROOT, "app", "src", "main", "assets")

def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()

# Inline the editor's helper scripts so the srcdoc iframe is self-contained.
_editor = open(os.path.join(A, "editor", "index.html"), encoding="utf-8").read()
for name in ("adv.js", "nav.js"):
    src = open(os.path.join(A, "editor", name), encoding="utf-8").read().replace("</script", "<\\/script")
    _editor = _editor.replace('<script src="%s"></script>' % name, "<script>\n" + src + "\n</script>")
editor_b64 = base64.b64encode(_editor.encode("utf-8")).decode()
engine_b64 = b64(os.path.join(A, "engine", "adventure.js"))
templates = {}
for t in os.listdir(os.path.join(A, "templates")):
    d = os.path.join(A, "templates", t)
    templates[t] = {f: open(os.path.join(d, f), encoding="utf-8").read() for f in sorted(os.listdir(d))}

PAGE = r"""<title>Thor IDE Simulator</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
  /* layout: a dark bench with the Thor's two screens stacked, top 16:9, bottom 1240:1080 */
  :root {
    --bg: #e9ebf0; --fg: #1a1d26; --dim: #5d6474; --shell: #262a36; --bezel: #0d0f14; --line: #cfd3dc;
    --acc: #0fa89a; --warn: #d9951b; --panel: #ffffff;
    --font: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f1117; --fg: #e3e6ee; --dim: #8b92a5; --shell: #1b1e28; --bezel: #000; --line: #262a36; --panel: #161925; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #0f1117; --fg: #e3e6ee; --dim: #8b92a5; --shell: #1b1e28; --bezel: #000; --line: #262a36; --panel: #161925; color-scheme: dark; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 var(--font); display: flex; flex-direction: column;
         padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 10px; gap: 10px; box-sizing: border-box; }
  header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .01em; }
  header .st { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
  header .sp { flex: 1; }
  button { font: inherit; background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
  .device { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .screen { position: relative; background: var(--bezel); border-radius: 10px; padding: 6px; box-shadow: 0 0 0 3px var(--shell); max-width: 100%; }
  /* iframes are laid out at the Thor's CSS-pixel sizes (what a WebView sees: ~704×396 top, ~452×394 bottom) and scaled to fit */
  .screen iframe { display: block; border: 0; background: #000; border-radius: 4px; transform-origin: top left; }
  #fTop { width: 704px; height: 396px; } #fBottom { width: 452px; height: 394px; }
  .screen .lbl { position: absolute; left: 10px; top: -20px; font-size: 11px; color: var(--dim); letter-spacing: .06em; text-transform: uppercase; }
  #top .inner { width: calc(704px * var(--k)); height: calc(396px * var(--k)); overflow: hidden; }
  #bottom .inner { width: calc(452px * var(--k)); height: calc(394px * var(--k)); overflow: hidden; }
  .screen iframe { transform: scale(var(--k)); }
  #backBtn { position: absolute; right: 14px; top: 14px; z-index: 2; background: #1b1f2a; color: #fff; border-color: #444; opacity: .85; }
  #backBtn[hidden] { display: none !important; }
  .note { font-size: 12px; color: var(--dim); max-width: 70ch; }
  .pad { display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap; user-select: none; }
  .dpad, .abxy { position: relative; width: 96px; height: 96px; }
  .dpad button, .abxy button { position: absolute; width: 32px; height: 32px; padding: 0; border-radius: 8px; font-weight: 700; }
  .abxy button { border-radius: 50%; }
  .u { left: 32px; top: 0; } .d { left: 32px; top: 64px; } .l { left: 0; top: 32px; } .r { left: 64px; top: 32px; }
  .mid { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .mid button { font-size: 11px; padding: 3px 10px; }
  .shoulders { display: flex; gap: 6px; }
  .pad button:active, .pad button.held { background: var(--acc); color: #0b0f14; }

</style>

<header>
  <h1>Thor IDE simulator</h1>
  <span class="st" id="st">editor on bottom · mode EDIT</span>
  <span class="sp"></span>
  <button id="btnReset" title="Wipe the simulated projects and reload the samples">Reset projects</button>
</header>

<div class="device">
  <div class="screen" id="top"><span class="lbl">Top screen · 6" 1920×1080 (≈704×396 css px)</span><button id="backBtn" hidden>◀ Editor</button><div class="inner"><iframe id="fTop" title="top screen"></iframe></div></div>
  <div class="screen" id="bottom"><span class="lbl">Bottom screen · 3.92" 1240×1080 (≈452×394 css px)</span><div class="inner"><iframe id="fBottom" title="bottom screen"></iframe></div></div>
</div>
<div class="pad" id="pad">
  <div class="dpad">
    <button data-b="UP" class="u">▲</button><button data-b="LEFT" class="l">◀</button><button data-b="RIGHT" class="r">▶</button><button data-b="DOWN" class="d">▼</button>
  </div>
  <div class="mid"><button data-b="SELECT">SELECT</button><button data-b="START">START</button><span class="st">keys: arrows · Z X C V = A B X Y · Q E = L1 R1 · Enter = START · Shift = SELECT</span></div>
  <div class="abxy">
    <button data-b="Y" class="u">Y</button><button data-b="X" class="l">X</button><button data-b="B" class="r">B</button><button data-b="A" class="d">A</button>
  </div>
  <div class="shoulders"><button data-b="L1">L1</button><button data-b="R1">R1</button></div>
</div>
<input type="file" id="mediaIn" accept="image/*,video/*" hidden>
<p class="note">Same editor and project templates as the APK; the Android side (Presentation + WebView + bridges) is replaced by two iframes and a JavaScript shim. Projects are kept in this browser only. Keyboard: click into the code and type, or use ⌨ for the on-screen keyboard.</p>

<script>
const EDITOR_HTML = decodeURIComponent(escape(atob("__EDITOR_B64__")));
const TEMPLATES = __TEMPLATES_JSON__;
const ENGINE_JS = decodeURIComponent(escape(atob("__ENGINE_B64__")));

/* ---------------- simulated project store (localStorage, guarded) */
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let projects = LS.get('thorsim.projects', null);
function seed() { projects = { 'my-game': { ...TEMPLATES['adventure-blank'] }, 'the-room': { ...TEMPLATES.adventure } }; save(); }
function save() { LS.set('thorsim.projects', projects); }
if (!projects || !Object.keys(projects).length) seed();
let current = LS.get('thorsim.current', Object.keys(projects)[0]);
if (!projects[current]) current = Object.keys(projects)[0];

/* ---------------- screen state */
let mode = 'EDIT', editorOnMain = false;
const fTop = document.getElementById('fTop'), fBottom = document.getElementById('fBottom');
const roles = { top: 'NONE', bottom: 'NONE' }; // what each iframe currently shows
function frame(which) { return which === 'top' ? fTop : fBottom; }
function screens() { return { dual: true, editorOnMain, mode, project: current, secondDisplayId: 1, secondDisplayName: 'simulated bottom screen' }; }
function status() { document.getElementById('st').textContent = 'editor on ' + (editorOnMain ? 'top' : 'bottom') + ' · mode ' + mode + ' · project ' + current; }

/* ---------------- building page sources */
function inlineAssets(html, files) {
  // Inline <script src="x.js"> and <link href="x.css"> that point at project files (the WebView loads them from disk).
  html = html.replace(/<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/g, (m, a, src, b) => {
    const f = files[src.replace(/^\.\//, '')]; return f != null ? '<script' + a + b + '>\n' + f.replace(/<\/script/gi, '<\\/script') + '\n<\/script>' : m;
  });
  html = html.replace(/<link([^>]*)\shref=["']([^"']+\.css)["']([^>]*)>/g, (m, a, href) => {
    const f = files[href.replace(/^\.\//, '')]; return f != null ? '<style>\n' + f + '\n</style>' : m;
  });
  return html;
}
function shimForApp(screen) {
  return `<script>
(function(){
  var S = '${screen}';
  window.ThorNative = { screen: function(){ return S; }, isDual: function(){ return parent.Sim.isRun(); }, send: function(json){ parent.Sim.send(S, json); } };
  function fwd(level){ var o = console[level]; console[level] = function(){ var a = [].slice.call(arguments).map(function(x){ try { return typeof x === 'string' ? x : JSON.stringify(x); } catch(e){ return String(x); } }).join(' '); parent.Sim.console(level === 'log' ? 'log' : level === 'warn' ? 'warning' : level, S, a, 0, ''); o && o.apply(console, arguments); }; }
  ['log','warn','error','info','debug'].forEach(fwd);
  window.addEventListener('error', function(e){ parent.Sim.console('error', S, e.message, e.lineno || 0, (e.filename || '').split('/').pop()); });
  window.addEventListener('unhandledrejection', function(e){ parent.Sim.console('error', S, 'Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason)); });
})();
<\/script>`;
}
function appSrc(file, screen) {
  const files = projects[current] || {};
  if (!(file in files)) return `<html><body style="background:#111;color:#aaa;font-family:sans-serif;padding:24px"><h3>${file} not found in project "${current}"</h3><p>Create it in the editor and press Run.</p></body></html>`;
  let html = inlineAssets(files[file], files);
  const media = {}; for (const k in files) if (k.startsWith('media/')) media[k] = files[k];
  const shim = shimForApp(screen) + '<script>window.THOR_MEDIA = ' + JSON.stringify(media).replace(/<\//g, '<\\/') + ';<\/script>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + shim) : shim + html;
}
function editorSrc() {
  const shim = `<script>
window.ThorIDE = {
  listProjects: () => parent.Sim.api.listProjects(), listFiles: (p) => parent.Sim.api.listFiles(p),
  readFile: (p, f) => parent.Sim.api.readFile(p, f), fileExists: (p, f) => parent.Sim.api.fileExists(p, f),
  writeFile: (p, f, c) => parent.Sim.api.writeFile(p, f, c), deleteFile: (p, f) => parent.Sim.api.deleteFile(p, f),
  renameFile: (p, a, b) => parent.Sim.api.renameFile(p, a, b), createProject: (n, t) => parent.Sim.api.createProject(n, t),
  deleteProject: (n) => parent.Sim.api.deleteProject(n), currentProject: () => parent.Sim.api.currentProject(),
  setProject: (n) => parent.Sim.api.setProject(n), screens: () => parent.Sim.api.screens(), projectsDir: () => '(simulator: this browser\\'s localStorage)',
  run: () => parent.Sim.api.run(), runDual: () => parent.Sim.api.runDual(), stop: () => parent.Sim.api.stop(),
  swapScreens: () => parent.Sim.api.swapScreens(), toast: (m) => parent.Sim.api.toast(m), evalInPreview: (js) => parent.Sim.api.evalInPreview(js),
  readAsset: (p) => parent.Sim.api.readAsset(p),
  importMedia: () => parent.Sim.api.importMedia(), fileUrl: (p, f) => parent.Sim.api.fileUrl(p, f),
};
<\/script>`;
  return EDITOR_HTML.replace(/<head[^>]*>/i, (m) => m + shim);
}

/* ---------------- role assignment (mirrors MainActivity.applyRoles) */
function load(which, role) {
  if (roles[which] === role && role === 'EDITOR') { evalOnEditor("window.ThorEvents && ThorEvents.emit('screens', " + JSON.stringify(screens()) + ")"); return; }
  roles[which] = role;
  const f = frame(which);
  f.srcdoc = role === 'EDITOR' ? editorSrc() : role === 'TOP' ? appSrc('index.html', 'top') : role === 'BOTTOM' ? appSrc('bottom.html', 'bottom') : '<html></html>';
}
function applyRoles() {
  document.getElementById('backBtn').hidden = mode !== 'RUN';
  if (mode === 'RUN') { load('top', 'TOP'); load('bottom', 'BOTTOM'); }
  else if (editorOnMain) { load('top', 'EDITOR'); load('bottom', 'TOP'); }
  else { load('bottom', 'EDITOR'); load('top', 'TOP'); }
  status();
}
function editorWin() { for (const w of ['top', 'bottom']) if (roles[w] === 'EDITOR') return frame(w).contentWindow; return null; }
function frameFor(role) { for (const w of ['top', 'bottom']) if (roles[w] === role) return frame(w); return null; }
function evalOnEditor(js) { const w = editorWin(); if (w) { try { w.eval(js); } catch (e) { console.warn('editor eval', e); } } }

/* ---------------- the bridge the shims call */
window.Sim = {
  isRun() { return mode === 'RUN'; },
  console(level, screen, msg, line, src) {
    evalOnEditor("window.ThorEvents && ThorEvents.emit('console', " + JSON.stringify({ level, screen, msg, line: line || 0, src: src || '' }) + ")");
  },
  send(fromScreen, json) {
    const target = frameFor(fromScreen === 'top' ? 'BOTTOM' : 'TOP');
    if (target) { try { target.contentWindow.eval('window.onThorMessage && window.onThorMessage(' + json + ')'); } catch (e) { Sim.console('error', fromScreen === 'top' ? 'bottom' : 'top', 'onThorMessage threw: ' + e.message); } }
    evalOnEditor("window.ThorEvents && ThorEvents.emit('console', " + JSON.stringify({ level: 'msg', screen: fromScreen, msg: json }) + ")");
  },
  api: {
    listProjects: () => JSON.stringify(Object.keys(projects).sort()),
    listFiles: (p) => JSON.stringify(Object.keys(projects[p] || {}).sort().map(path => ({ path, size: projects[p][path].length, mtime: 0 }))),
    readFile: (p, f) => (projects[p] && projects[p][f]) || '',
    fileExists: (p, f) => !!(projects[p] && f in projects[p]),
    writeFile: (p, f, c) => { if (!projects[p]) return false; projects[p][f] = c; save(); return true; },
    deleteFile: (p, f) => { if (!projects[p]) return false; delete projects[p][f]; save(); return true; },
    renameFile: (p, a, b) => { if (!projects[p] || !(a in projects[p]) || b in projects[p]) return false; projects[p][b] = projects[p][a]; delete projects[p][a]; save(); return true; },
    createProject: (n, t) => { if (!/^[A-Za-z0-9._-]{1,64}$/.test(n) || projects[n]) return false; projects[n] = { ...(TEMPLATES[t] || TEMPLATES.blank) }; current = n; save(); LS.set('thorsim.current', n); return true; },
    deleteProject: (n) => { delete projects[n]; if (!Object.keys(projects).length) seed(); if (current === n) current = Object.keys(projects)[0]; save(); LS.set('thorsim.current', current); return true; },
    currentProject: () => current,
    setProject: (n) => { current = n; LS.set('thorsim.current', n); status(); const w = roles.top === 'TOP' ? 'top' : roles.bottom === 'TOP' ? 'bottom' : null; if (w) { roles[w] = 'NONE'; load(w, 'TOP'); } },
    screens: () => JSON.stringify(screens()),
    readAsset: (p) => p === 'engine/adventure.js' ? ENGINE_JS : '',
    fileUrl: (p, f) => (projects[p] && projects[p][f]) || '',
    importMedia: () => document.getElementById('mediaIn').click(),
    run: () => { const w = roles.top === 'TOP' ? 'top' : roles.bottom === 'TOP' ? 'bottom' : null; if (w) { roles[w] = 'NONE'; load(w, 'TOP'); } else applyRoles(); },
    runDual: () => { mode = 'RUN'; applyRoles(); },
    stop: () => { mode = 'EDIT'; applyRoles(); },
    swapScreens: () => { editorOnMain = !editorOnMain; roles.top = roles.bottom = 'NONE'; applyRoles(); },
    toast: (m) => { const t = document.createElement('div'); t.textContent = m; Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', background: '#222', color: '#fff', padding: '8px 14px', borderRadius: '8px', zIndex: 9, fontSize: '13px' }); document.body.appendChild(t); setTimeout(() => t.remove(), 1800); },
    evalInPreview: (js) => { const f = frameFor('TOP'); if (!f) return; let v; try { v = f.contentWindow.eval(js); v = v === undefined ? 'undefined' : (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v)); } catch (e) { v = 'Error: ' + e.message; } evalOnEditor("window.ThorEvents && ThorEvents.emit('evalResult', " + JSON.stringify(String(v)) + ")"); },
  },
};

document.getElementById('backBtn').onclick = () => Sim.api.stop();
document.getElementById('mediaIn').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const name = f.name.replace(/[^A-Za-z0-9._-]/g, '_'), path = 'media/' + name;
    projects[current][path] = r.result;
    try { save(); } catch (e) { Sim.api.toast('Kept in memory only (browser storage full)'); }
    evalOnEditor("window.ThorEvents && ThorEvents.emit('imported', " + JSON.stringify({ ok: true, path }) + ")");
  };
  r.readAsDataURL(f);
});
function fitScreens() {
  const dev = document.querySelector('.device');
  const availW = dev.clientWidth - 24, availH = Math.max(300, window.innerHeight - 260);
  // both screens stack: 396k + 394k + gaps ≈ 820k
  const k = Math.max(0.5, Math.min(1.4, availW / 704, availH / 830));
  document.documentElement.style.setProperty('--k', k.toFixed(3));
}
window.addEventListener('resize', fitScreens); fitScreens();

/* ---------------- controller: on-screen pad + keyboard → every live screen */
function padButton(name, down) {
  for (const w of ['top', 'bottom']) {
    if (roles[w] === 'NONE') continue;
    try { const win = frame(w).contentWindow; win.ThorInput && win.ThorInput.button(name, down); } catch (e) {}
  }
}
document.querySelectorAll('#pad button').forEach(b => {
  const n = b.dataset.b;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('held'); padButton(n, true); });
  const up = () => { if (b.classList.contains('held')) { b.classList.remove('held'); padButton(n, false); } };
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
});
const KEYS = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', z: 'A', x: 'B', c: 'X', v: 'Y', q: 'L1', e: 'R1', Enter: 'START', Shift: 'SELECT' };
window.addEventListener('keydown', (ev) => { const n = KEYS[ev.key]; if (n && !ev.repeat && document.activeElement === document.body) { ev.preventDefault(); padButton(n, true); } });
window.addEventListener('keyup', (ev) => { const n = KEYS[ev.key]; if (n && document.activeElement === document.body) { ev.preventDefault(); padButton(n, false); } });
document.getElementById('btnReset').onclick = () => { seed(); current = 'my-game'; LS.set('thorsim.current', current); try { Object.keys(localStorage).filter(k => k.startsWith('__')).forEach(k => localStorage.removeItem(k)); } catch {} roles.top = roles.bottom = 'NONE'; applyRoles(); };
applyRoles();
</script>
"""

out = PAGE.replace("__EDITOR_B64__", editor_b64).replace("__ENGINE_B64__", engine_b64).replace("__TEMPLATES_JSON__", json.dumps(templates).replace("</", "<\\/"))
os.makedirs(os.path.join(ROOT, "sim"), exist_ok=True)
dst = os.path.join(ROOT, "sim", "thor-ide-simulator.html")
open(dst, "w", encoding="utf-8").write(out)
print(dst, len(out), "bytes")
