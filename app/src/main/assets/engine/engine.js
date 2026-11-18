/* Thor engine — runtime for block projects (game.json).
 *
 * One engine instance per screen. The TOP screen is authoritative: it runs the event sheet,
 * moves sprites and keeps all state. The BOTTOM screen is a renderer: it draws the sprites
 * that belong to it from snapshots the top sends, and forwards its touch/controller input.
 * In a plain browser (no ThorNative) the top page runs alone.
 *
 * Logical coordinates: top screen 1920×1080, bottom screen 1240×1080, origin top-left.
 */
(function () {
  'use strict';

  const SCREENS = { top: { w: 1920, h: 1080 }, bottom: { w: 1240, h: 1080 } };
  const BUTTONS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'START', 'SELECT', 'L3', 'R3'];

  const screen = (window.ThorNative && ThorNative.screen() === 'bottom') ? 'bottom' : 'top';
  const isAuthority = screen === 'top';
  const send = (o) => { if (window.ThorNative) ThorNative.send(JSON.stringify(o)); };

  // ---------------------------------------------------------------- canvas
  const canvas = document.getElementById('game') || (() => { const c = document.createElement('canvas'); c.id = 'game'; document.body.appendChild(c); return c; })();
  const ctx = canvas.getContext('2d');
  const dim = SCREENS[screen];
  canvas.width = dim.w; canvas.height = dim.h;
  let fit = function () {
    const s = Math.min(window.innerWidth / dim.w, window.innerHeight / dim.h);
    canvas.style.width = (dim.w * s) + 'px'; canvas.style.height = (dim.h * s) + 'px';
    canvas.style.position = 'absolute';
    canvas.style.left = ((window.innerWidth - dim.w * s) / 2) + 'px';
    canvas.style.top = ((window.innerHeight - dim.h * s) / 2) + 'px';
  }
  // DOM overlay for photos / GIFs / videos: GIFs animate and videos play natively there,
  // which a canvas can't do. It sits exactly over the canvas and is scaled with it.
  const overlay = document.createElement('div'); overlay.id = 'media';
  Object.assign(overlay.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', transformOrigin: '0 0', width: dim.w + 'px', height: dim.h + 'px' });
  document.body.appendChild(overlay);
  let scale = 1;
  function fitOverlay() { overlay.style.left = canvas.style.left; overlay.style.top = canvas.style.top; overlay.style.transform = 'scale(' + scale + ')'; }
  const _fit = fit; fit = function () { _fit(); scale = Math.min(window.innerWidth / dim.w, window.innerHeight / dim.h); fitOverlay(); };
  window.addEventListener('resize', fit); fit();
  const mediaUrl = (path) => (window.THOR_MEDIA && window.THOR_MEDIA[path]) || path;
  const mediaEls = {}; // sprite id -> element
  function toLogical(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * dim.w, y: (ev.clientY - r.top) / r.height * dim.h };
  }

  // ---------------------------------------------------------------- state
  const G = window.GAME || { sprites: [], vars: {}, events: [], background: { top: '#101418', bottom: '#1a1410' } };
  const S = {
    sprites: {},            // id -> sprite
    order: [],              // draw order
    vars: Object.assign({}, G.vars || {}),
    down: {}, pressed: {}, released: {},  // buttons
    stick: { lx: 0, ly: 0, rx: 0, ry: 0 },
    touches: [],            // {screen, x, y, sprite}
    timers: {},
    time: 0, dt: 0, frame: 0,
    messages: [],           // from other screen (user-level)
  };
  for (const sp of G.sprites || []) {
    const s = Object.assign({ x: 100, y: 100, w: 80, h: 80, color: '#3dd6c6', shape: 'rect', text: '', size: 48, screen: 'top', visible: true, vx: 0, vy: 0, angle: 0, startX: 0, startY: 0 }, sp);
    s.startX = s.x; s.startY = s.y;
    S.sprites[s.id] = s; S.order.push(s.id);
  }

  // ---------------------------------------------------------------- values
  function val(v, ctxSprite) {
    if (v == null) return 0;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if ('n' in v) return v.n;
    if ('s' in v) return v.s;
    if ('v' in v) return S.vars[v.v] ?? 0;
    if ('p' in v) { const sp = S.sprites[v.p[0]] || ctxSprite; return sp ? sp[v.p[1]] ?? 0 : 0; }
    if ('rnd' in v) { const [a, b] = v.rnd; return Math.floor(a + Math.random() * (b - a + 1)); }
    if ('stick' in v) return S.stick[v.stick] ?? 0;
    if ('touchx' in v) return S.touches.length ? S.touches[0].x : 0;
    if ('touchy' in v) return S.touches.length ? S.touches[0].y : 0;
    if ('time' in v) return Math.floor(S.time);
    if ('op' in v) {
      const ra = val(v.a, ctxSprite), rb = val(v.b, ctxSprite);
      if (v.op === '+' && (typeof ra === 'string' || typeof rb === 'string')) return String(ra) + String(rb);
      const a = +ra || 0, b = +rb || 0;
      return v.op === '+' ? a + b : v.op === '-' ? a - b : v.op === '*' ? a * b : v.op === '/' ? (b ? a / b : 0) : 0;
    }
    return 0;
  }
  function cmp(a, op, b) {
    switch (op) { case '=': return a == b; case '!=': return a != b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
    return false;
  }
  function overlap(a, b) {
    if (!a || !b || !a.visible || !b.visible || a.screen !== b.screen) return false;
    const ax = a.x - a.w / 2, ay = a.y - a.h / 2, bx = b.x - b.w / 2, by = b.y - b.h / 2;
    return ax < bx + b.w && ax + a.w > bx && ay < by + b.h && ay + a.h > by;
  }
  function hit(sp, x, y) { return sp.visible && Math.abs(x - sp.x) <= sp.w / 2 && Math.abs(y - sp.y) <= sp.h / 2; }

  // ---------------------------------------------------------------- event sheet
  function condOk(c, ctxSprite) {
    switch (c.type) {
      case 'var': return cmp(val({ v: c.name }), c.op, val(c.value, ctxSprite));
      case 'prop': return cmp(val({ p: [c.sprite, c.prop] }), c.op, val(c.value, ctxSprite));
      case 'touching': return overlap(S.sprites[c.a], S.sprites[c.b]);
      case 'held': return !!S.down[c.button];
      case 'visible': return !!(S.sprites[c.sprite] && S.sprites[c.sprite].visible);
      case 'chance': return Math.random() * 100 < +val(c.percent);
      case 'offscreen': { const s = S.sprites[c.sprite]; if (!s) return false; const d = SCREENS[s.screen]; return s.x < -s.w / 2 || s.x > d.w + s.w / 2 || s.y < -s.h / 2 || s.y > d.h + s.h / 2; }
    }
    return true;
  }
  function triggered(w) {
    switch (w.type) {
      case 'start': return S.frame === 0;
      case 'frame': return true;
      case 'button': return w.phase === 'held' ? !!S.down[w.button] : w.phase === 'up' ? !!S.released[w.button] : !!S.pressed[w.button];
      case 'tap': return S.touches.some(t => t.fresh && (w.target === 'top' || w.target === 'bottom' ? t.screen === w.target : t.sprite === w.target));
      case 'touching': return overlap(S.sprites[w.a], S.sprites[w.b]);
      case 'every': { const k = 'ev' + w.id; S.timers[k] = (S.timers[k] || 0) + S.dt; if (S.timers[k] >= +val(w.seconds)) { S.timers[k] = 0; return true; } return false; }
      case 'message': return S.messages.some(m => m.name === w.name);
      case 'offscreen': return condOk({ type: 'offscreen', sprite: w.sprite });
    }
    return false;
  }
  function run(actions, ctxSprite) {
    for (const a of actions) act(a, ctxSprite);
  }
  function act(a, ctxSprite) {
    const sp = a.sprite ? S.sprites[a.sprite] : ctxSprite;
    switch (a.type) {
      case 'move': if (sp) { sp.x += +val(a.dx, sp); sp.y += +val(a.dy, sp); } break;
      case 'set': if (sp) sp[a.prop] = a.prop === 'text' || a.prop === 'color' || a.prop === 'screen' || a.prop === 'shape' ? val(a.value, sp) : +val(a.value, sp); break;
      case 'change': if (sp) sp[a.prop] = (+sp[a.prop] || 0) + +val(a.value, sp); break;
      case 'moveto': if (sp) { sp.x = +val(a.x, sp); sp.y = +val(a.y, sp); } break;
      case 'moveToTouch': if (sp && S.touches.length) { sp.x = S.touches[0].x; sp.y = S.touches[0].y; } break;
      case 'moveToSprite': { const t = S.sprites[a.target]; if (sp && t) { sp.x = t.x; sp.y = t.y; sp.screen = t.screen; } break; }
      case 'home': if (sp) { sp.x = sp.startX; sp.y = sp.startY; sp.vx = sp.vy = 0; } break;
      case 'show': if (sp) sp.visible = true; break;
      case 'hide': if (sp) sp.visible = false; break;
      case 'toggle': if (sp) sp.visible = !sp.visible; break;
      case 'say': if (sp) sp.text = String(val(a.text, sp)); break;
      case 'color': if (sp) sp.color = String(val(a.color, sp)); break;
      case 'screen': if (sp) sp.screen = a.screen; break;
      case 'var_set': S.vars[a.name] = val(a.value, sp); break;
      case 'var_change': S.vars[a.name] = (+S.vars[a.name] || 0) + +val(a.value, sp); break;
      case 'send': send({ __user: true, name: a.name, value: val(a.value, sp) }); break;
      case 'bounce': if (sp) { const d = SCREENS[sp.screen]; if (sp.x < sp.w / 2) { sp.x = sp.w / 2; sp.vx = Math.abs(sp.vx); } if (sp.x > d.w - sp.w / 2) { sp.x = d.w - sp.w / 2; sp.vx = -Math.abs(sp.vx); } if (sp.y < sp.h / 2) { sp.y = sp.h / 2; sp.vy = Math.abs(sp.vy); } if (sp.y > d.h - sp.h / 2) { sp.y = d.h - sp.h / 2; sp.vy = -Math.abs(sp.vy); } } break;
      case 'keepOnScreen': if (sp) { const d = SCREENS[sp.screen]; sp.x = Math.max(sp.w / 2, Math.min(d.w - sp.w / 2, sp.x)); sp.y = Math.max(sp.h / 2, Math.min(d.h - sp.h / 2, sp.y)); } break;
      case 'wrap': if (sp) { const d = SCREENS[sp.screen]; if (sp.x < -sp.w / 2) sp.x = d.w + sp.w / 2; if (sp.x > d.w + sp.w / 2) sp.x = -sp.w / 2; if (sp.y < -sp.h / 2) sp.y = d.h + sp.h / 2; if (sp.y > d.h + sp.h / 2) sp.y = -sp.h / 2; } break;
      case 'beep': beep(+val(a.freq) || 440, +val(a.ms) || 80); break;
      case 'log': console.log(String(val(a.text, sp))); break;
      case 'restart': restart(); break;
      case 'image': if (sp) { sp.image = String(val(a.image, sp)); sp.shape = /\.(mp4|webm|mov|3gp|m4v)$/i.test(sp.image) ? 'video' : 'image'; } break;
      case 'play': mediaCmd(sp, 'play'); break;
      case 'pause': mediaCmd(sp, 'pause'); break;
      case 'if': if ((a.conds || []).every(c => condOk(c, sp))) run(a.then || [], sp); else run(a.else || [], sp); break;
    }
  }
  function mediaCmd(sp, cmd) {
    if (!sp) return;
    const el = mediaEls[sp.id];
    if (el && el.tagName === 'VIDEO') { try { if (cmd === 'play') { el.currentTime = 0; el.play(); } else el.pause(); } catch (e) {} }
    if (isAuthority && sp.screen === 'bottom') send({ __media: cmd, id: sp.id });
  }
  function restart() {
    for (const id of S.order) { const s = S.sprites[id]; const o = (G.sprites || []).find(x => x.id === id) || {}; Object.assign(s, { x: s.startX, y: s.startY, vx: 0, vy: 0, visible: o.visible !== false, text: o.text || '', color: o.color || s.color, screen: o.screen || 'top' }); }
    S.vars = Object.assign({}, G.vars || {}); S.timers = {}; S.frame = 0; S.time = 0;
  }

  // ---------------------------------------------------------------- audio
  let actx = null;
  function beep(freq, ms) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.08;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- input
  function button(name, down) {
    if (!BUTTONS.includes(name)) return;
    if (down && !S.down[name]) S.pressed[name] = true;
    if (!down && S.down[name]) S.released[name] = true;
    S.down[name] = down;
  }
  function inputButton(name, down) { if (isAuthority) button(name, !!down); else send({ __input: 'button', name, down: !!down }); }
  function inputAxes(lx, ly, rx, ry) { const a = { lx, ly, rx, ry }; if (isAuthority) Object.assign(S.stick, a); else send({ __input: 'axes', a }); }
  // Native layer (MainActivity) and the simulator's on-screen controller call window.ThorInput.
  let nativeInputSeen = false;
  window.ThorInput = {
    button(name, down) { nativeInputSeen = true; inputButton(name, down); },
    axes(lx, ly, rx, ry) { nativeInputSeen = true; inputAxes(lx, ly, rx, ry); },
  };
  // Gamepad API fallback (desktop browsers; WebView too if nothing arrives from the native layer).
  const gpPrev = {};
  const GP_MAP = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SELECT', 9: 'START', 10: 'L3', 11: 'R3', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };
  function pollGamepad() {
    if (nativeInputSeen || !navigator.getGamepads) return;
    let gps; try { gps = navigator.getGamepads(); } catch (e) { return; }
    for (const gp of gps || []) {
      if (!gp) continue;
      gp.buttons.forEach((b, i) => { const n = GP_MAP[i]; if (!n) return; const d = b.pressed || b.value > 0.5; if (d !== !!gpPrev[n]) { gpPrev[n] = d; inputButton(n, d); } });
      const dz = (v) => Math.abs(v) < 0.15 ? 0 : v;
      inputAxes(dz(gp.axes[0] || 0), dz(gp.axes[1] || 0), dz(gp.axes[2] || 0), dz(gp.axes[3] || 0));
    }
  }
  // Keyboard (desktop testing): arrows = D-pad, Z/X/C/V = A/B/X/Y, Q/E = L1/R1, Enter = START, Shift = SELECT
  const KEY_MAP = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', z: 'A', x: 'B', c: 'X', v: 'Y', q: 'L1', e: 'R1', Enter: 'START', Shift: 'SELECT' };
  window.addEventListener('keydown', (e) => { const n = KEY_MAP[e.key]; if (n && !e.repeat) { inputButton(n, true); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { const n = KEY_MAP[e.key]; if (n) { inputButton(n, false); e.preventDefault(); } });

  // Touch
  function touchAt(scr, x, y, fresh) {
    let spId = null;
    for (let i = S.order.length - 1; i >= 0; i--) { const sp = S.sprites[S.order[i]]; if (sp.screen === scr && hit(sp, x, y)) { spId = sp.id; break; } }
    return { screen: scr, x, y, sprite: spId, fresh };
  }
  const activeTouch = {}; // pointerId -> screen
  canvas.addEventListener('pointerdown', (e) => {
    const p = toLogical(e); activeTouch[e.pointerId] = true;
    if (isAuthority) { S.touches = S.touches.filter(t => t.screen !== screen || t.up); S.touches.push(touchAt(screen, p.x, p.y, true)); } else send({ __input: 'touch', phase: 'down', x: p.x, y: p.y });
    if (actx && actx.state === 'suspended') actx.resume();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!activeTouch[e.pointerId]) return; const p = toLogical(e);
    if (isAuthority) { const t = S.touches.find(t => t.screen === screen); if (t) { t.x = p.x; t.y = p.y; } } else send({ __input: 'touch', phase: 'move', x: p.x, y: p.y });
  });
  const endTouch = (e) => {
    delete activeTouch[e.pointerId];
    // Mark as ended; removed after this frame's events ran, so a quick tap still counts.
    if (isAuthority) S.touches.forEach(t => { if (t.screen === screen) t.up = true; }); else send({ __input: 'touch', phase: 'up' });
  };
  canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);

  // Messages from the other screen
  window.onThorMessage = function (m) {
    if (!m) return;
    if (m.__input) {
      nativeInputSeen = true;
      if (m.__input === 'button') button(m.name, m.down);
      else if (m.__input === 'axes') Object.assign(S.stick, m.a);
      else if (m.__input === 'touch') {
        if (m.phase === 'down') { S.touches = S.touches.filter(t => t.screen !== 'bottom' || t.up); S.touches.push(touchAt('bottom', m.x, m.y, true)); }
        else if (m.phase === 'move') { const t = S.touches.find(t => t.screen === 'bottom'); if (t) { t.x = m.x; t.y = m.y; } }
        else S.touches.forEach(t => { if (t.screen === 'bottom') t.up = true; });
      }
    } else if (m.__media) {
      const el = mediaEls[m.id]; if (el && el.tagName === 'VIDEO') { try { if (m.__media === 'play') { el.currentTime = 0; el.play(); } else el.pause(); } catch (e) {} }
    } else if (m.__snap) {
      // bottom renderer: replace sprite state
      for (const sp of m.sprites) { S.sprites[sp.id] = sp; }
      S.order = m.sprites.map(s => s.id);
      S.vars = m.vars || S.vars;
      draw();
    } else if (m.__user) {
      S.messages.push(m);
    }
  };

  // ---------------------------------------------------------------- draw
  function syncMedia(sp, z) {
    let el = mediaEls[sp.id];
    const want = sp.shape === 'video' ? 'VIDEO' : 'IMG';
    if (el && (el.tagName !== want || el.dataset.src !== sp.image)) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement(want === 'VIDEO' ? 'video' : 'img');
      el.dataset.src = sp.image || '';
      el.src = mediaUrl(sp.image || '');
      if (want === 'VIDEO') { el.muted = true; el.loop = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.autoplay = true; el.addEventListener('loadeddata', () => { try { el.play(); } catch (e) {} }); }
      el.draggable = false;
      Object.assign(el.style, { position: 'absolute', objectFit: 'fill', pointerEvents: 'none', transformOrigin: '50% 50%' });
      overlay.appendChild(el); mediaEls[sp.id] = el;
    }
    const show = sp.visible && sp.screen === screen;
    el.style.display = show ? 'block' : 'none';
    if (!show) return;
    el.style.left = (sp.x - sp.w / 2) + 'px'; el.style.top = (sp.y - sp.h / 2) + 'px';
    el.style.width = sp.w + 'px'; el.style.height = sp.h + 'px';
    el.style.transform = sp.angle ? 'rotate(' + sp.angle + 'deg)' : ''; el.style.zIndex = z;
    el.style.opacity = sp.opacity == null ? 1 : sp.opacity;
  }
  function draw() {
    ctx.fillStyle = (G.background && G.background[screen]) || '#000';
    ctx.fillRect(0, 0, dim.w, dim.h);
    let z = 0;
    for (const id in mediaEls) { if (!S.sprites[id] || (S.sprites[id].shape !== 'image' && S.sprites[id].shape !== 'video')) { mediaEls[id].remove(); delete mediaEls[id]; } }
    for (const id of S.order) {
      const sp = S.sprites[id];
      if (sp && (sp.shape === 'image' || sp.shape === 'video')) { syncMedia(sp, ++z); continue; }
      if (!sp || !sp.visible || sp.screen !== screen) continue;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (sp.angle) ctx.rotate(sp.angle * Math.PI / 180);
      ctx.fillStyle = sp.color;
      if (sp.shape === 'circle') { ctx.beginPath(); ctx.ellipse(0, 0, sp.w / 2, sp.h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (sp.shape === 'rect') ctx.fillRect(-sp.w / 2, -sp.h / 2, sp.w, sp.h);
      else if (sp.shape === 'triangle') { ctx.beginPath(); ctx.moveTo(0, -sp.h / 2); ctx.lineTo(sp.w / 2, sp.h / 2); ctx.lineTo(-sp.w / 2, sp.h / 2); ctx.closePath(); ctx.fill(); }
      if (sp.text) {
        ctx.fillStyle = sp.shape === 'text' ? sp.color : '#fff';
        ctx.font = 'bold ' + (sp.size || 48) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(sp.text), 0, sp.shape === 'text' ? 0 : 0);
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- loop (authority)
  let last = performance.now(), snapTimer = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    S.dt = Math.min(0.05, (now - last) / 1000); last = now; S.time += S.dt;
    pollGamepad();
    // physics
    for (const id of S.order) { const sp = S.sprites[id]; sp.x += (sp.vx || 0) * S.dt; sp.y += (sp.vy || 0) * S.dt; }
    // events
    for (const ev of G.events || []) {
      if (!triggered(ev.when)) continue;
      if ((ev.conds || []).every(c => condOk(c))) run(ev.do || []);
    }
    // end of frame bookkeeping
    S.pressed = {}; S.released = {}; S.messages = [];
    S.touches = S.touches.filter(t => !t.up);
    for (const t of S.touches) t.fresh = false;
    S.frame++;
    draw();
    // snapshot bottom-screen sprites to the other screen (~30 Hz)
    snapTimer += S.dt;
    if (window.ThorNative && ThorNative.isDual() && snapTimer >= 1 / 30) {
      snapTimer = 0;
      const sprites = S.order.map(id => S.sprites[id]).filter(s => s.screen === 'bottom').map(s => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), w: s.w, h: s.h, color: s.color, shape: s.shape, text: s.text, size: s.size, screen: s.screen, visible: s.visible, angle: s.angle, image: s.image, opacity: s.opacity }));
      send({ __snap: true, sprites, vars: S.vars });
    }
  }
  if (isAuthority) requestAnimationFrame(tick); else draw();

  // Expose for the IDE's eval box
  window.Thor = { state: S, game: G, restart, button: (n, d) => window.ThorInput.button(n, d) };
})();
