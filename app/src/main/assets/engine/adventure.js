/* Thor adventure engine — runtime for point-and-click projects (adventure.json).
 *
 * TOP screen (authority): the current scene — background, hotspots, speech bubbles. Runs scripts.
 * BOTTOM screen: the dialog box (text, "tap to continue"), choices and the inventory bar.
 *   It renders from state snapshots the top sends and forwards taps/button presses back.
 * Single screen (no bottom display, or plain browser): the dialog panel is drawn over the scene.
 *
 * Logical coordinates: top 1920×1080, bottom 1240×1080. Everything is DOM, no canvas.
 */
(function () {
  'use strict';
  const SCREENS = { top: { w: 1920, h: 1080 }, bottom: { w: 1240, h: 1080 } };
  const screen = (window.ThorNative && ThorNative.screen() === 'bottom') ? 'bottom' : 'top';
  const isTop = screen === 'top';
  const dual = () => !!(window.ThorNative && ThorNative.isDual());
  const send = (o) => { if (window.ThorNative) ThorNative.send(JSON.stringify(o)); };
  const mediaUrl = (p) => (window.THOR_MEDIA && window.THOR_MEDIA[p]) || p;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const G = window.GAME || { start: '', scenes: [], vars: {}, items: [], globalScripts: [] };
  const dim = SCREENS[screen];

  // ---------------------------------------------------------------- stage (scaled 1920×1080 / 1240×1080 box)
  const stage = document.createElement('div'); stage.id = 'stage';
  Object.assign(stage.style, { position: 'absolute', width: dim.w + 'px', height: dim.h + 'px', transformOrigin: '0 0', overflow: 'hidden', background: '#000', touchAction: 'none', userSelect: 'none' });
  document.body.appendChild(stage);
  let scale = 1;
  function fit() {
    scale = Math.min(window.innerWidth / dim.w, window.innerHeight / dim.h);
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.left = ((window.innerWidth - dim.w * scale) / 2) + 'px';
    stage.style.top = ((window.innerHeight - dim.h * scale) / 2) + 'px';
  }
  window.addEventListener('resize', fit); fit();
  const css = document.createElement('style');
  css.textContent = `
    #stage { font-family: system-ui, sans-serif; color: #fff; }
    .bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
    .hs { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 12px; box-sizing: border-box; cursor: pointer; }
    .hs img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
    .hs.focus { outline: 6px solid #fff; outline-offset: 4px; box-shadow: 0 0 0 12px rgba(255,255,255,.25); }
    .hs .lbl { position: absolute; left: 50%; top: -52px; transform: translateX(-50%); background: rgba(0,0,0,.7); padding: 6px 14px; border-radius: 10px; font-size: 30px; white-space: nowrap; }
    .bubble { position: absolute; max-width: 700px; background: #fff; color: #111; padding: 22px 28px; border-radius: 22px; font-size: 36px; line-height: 1.3; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
    .bubble:after { content: ''; position: absolute; left: 50px; bottom: -24px; border: 14px solid transparent; border-top-color: #fff; border-bottom: 0; }
    .picture { position: absolute; inset: 0; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 20px; }
    .picture img { max-width: 85%; max-height: 80%; border-radius: 16px; box-shadow: 0 10px 40px #000; }
    .picture .cap { font-size: 40px; background: rgba(0,0,0,.6); padding: 10px 24px; border-radius: 12px; }
    .panel { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,.85) 30%); padding: 40px 60px 40px; display: flex; flex-direction: column; gap: 18px; min-height: 300px; box-sizing: border-box; }
    .panel.bottomScreen { top: 0; background: #14110f; padding: 50px 60px; justify-content: space-between; }
    .dlg { background: rgba(20,20,26,.92); border: 3px solid #f5b942; border-radius: 18px; padding: 26px 34px; font-size: 40px; line-height: 1.35; min-height: 150px; }
    .dlg .who { color: #f5b942; font-weight: 700; font-size: 30px; margin-bottom: 8px; }
    .dlg .hint { color: #9aa; font-size: 26px; text-align: right; margin-top: 10px; }
    .choices { display: flex; flex-direction: column; gap: 12px; }
    .choice { background: #243447; border: 3px solid #3dd6c6; border-radius: 14px; padding: 18px 26px; font-size: 36px; cursor: pointer; }
    .choice.focus { background: #3dd6c6; color: #0b0f14; }
    .inv { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; min-height: 110px; }
    .inv .title { color: #9aa; font-size: 26px; margin-right: 10px; }
    .item { width: 110px; height: 110px; background: #2a2f3a; border: 3px solid #555; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 22px; text-align: center; overflow: hidden; cursor: pointer; }
    .item img { width: 100%; height: 100%; object-fit: contain; }
    .item.sel { border-color: #f5b942; box-shadow: 0 0 0 6px rgba(245,185,66,.4); }
    .toast { position: absolute; top: 30px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.7); padding: 14px 30px; border-radius: 14px; font-size: 32px; }
    .end { position: absolute; inset: 0; background: #000; display: flex; align-items: center; justify-content: center; font-size: 90px; }
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- state (authority)
  const S = {
    scene: G.start || (G.scenes[0] && G.scenes[0].id) || '',
    vars: Object.assign({}, G.vars || {}),
    inventory: [],
    vis: {},              // 'scene/hotspot' -> true/false when a script showed/hid it
    moved: {},            // 'scene/hotspot' -> {x,y}
    bg: {},               // scene id -> background override
    dialog: null,         // { who, text }
    choices: null,        // { question, options: [text] }
    picture: null,        // { image, caption }
    selectedItem: null,
    focusHotspot: 0, focusChoice: 0,
    ended: null,
    busy: false,
  };
  const scene = () => G.scenes.find(s => s.id === S.scene) || G.scenes[0] || { hotspots: [], scripts: [] };
  const key = (h) => S.scene + '/' + h.id;
  const isVisible = (h) => (key(h) in S.vis) ? S.vis[key(h)] : h.visible !== false;
  const visibleHotspots = () => scene().hotspots.filter(isVisible);
  const itemDef = (id) => (G.items || []).find(i => i.id === id) || { id, label: id };

  // ---------------------------------------------------------------- script interpreter
  let waiter = null; // resolve function for the current wait (advance / choice)
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function waitFor(kind) { return new Promise(res => { waiter = { kind, res }; }); }
  function resume(kind, value) { if (waiter && waiter.kind === kind) { const w = waiter; waiter = null; w.res(value); } }

  function evalValue(v) {
    if (v == null) return 0;
    if (typeof v !== 'object') return v;
    if ('n' in v) return v.n; if ('s' in v) return v.s; if ('v' in v) return S.vars[v.v] ?? 0;
    if ('rnd' in v) return Math.floor(v.rnd[0] + Math.random() * (v.rnd[1] - v.rnd[0] + 1));
    return 0;
  }
  function cond(c) {
    if (!c) return true;
    switch (c.type) {
      case 'var': { const a = evalValue({ v: c.name }), b = evalValue(c.value); switch (c.op) { case '=': return a == b; case '!=': return a != b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; } return false; }
      case 'has': return S.inventory.includes(c.item);
      case 'nothas': return !S.inventory.includes(c.item);
      case 'visible': { const h = scene().hotspots.find(h => h.id === c.hotspot); return !!h && isVisible(h); }
      case 'chance': return Math.random() * 100 < +evalValue(c.percent);
    }
    return false;
  }
  async function runBlocks(blocks) {
    for (const b of blocks || []) {
      if (S.ended) return;
      await runBlock(b);
    }
  }
  let depth = 0;
  async function runBlock(b) {
    switch (b.type) {
      case 'say': {
        const who = b.who && b.who !== 'narrator' ? b.who : null;
        S.dialog = { who: who ? (scene().hotspots.find(h => h.id === who) || {}).label || who : '', text: String(evalValue(b.text)), hotspot: who };
        render(); await waitFor('advance'); S.dialog = null; render(); break;
      }
      case 'picture': S.picture = { image: b.image, caption: String(evalValue(b.caption) || '') }; render(); if (b.wait !== false) { await waitFor('advance'); S.picture = null; render(); } break;
      case 'hidePicture': S.picture = null; render(); break;
      case 'goto': S.scene = b.scene; S.focusHotspot = 0; render(); await runSceneStart(); break;
      case 'set': S.vars[b.name] = evalValue(b.value); break;
      case 'change': S.vars[b.name] = (+S.vars[b.name] || 0) + +evalValue(b.value); break;
      case 'if': if (cond(b.cond)) await runBlocks(b.then); else await runBlocks(b.else); break;
      case 'choice': {
        S.choices = { question: String(evalValue(b.question) || ''), options: (b.options || []).map(o => String(evalValue(o.text))) }; S.focusChoice = 0; render();
        const i = await waitFor('choice'); S.choices = null; render();
        await runBlocks((b.options[i] || {}).blocks); break;
      }
      case 'wait': await sleep(1000 * (+evalValue(b.seconds) || 0)); break;
      case 'showHotspot': { const h = findHotspot(b.hotspot); if (h) S.vis[h.k] = true; render(); break; }
      case 'hideHotspot': { const h = findHotspot(b.hotspot); if (h) S.vis[h.k] = false; render(); break; }
      case 'moveHotspot': { const h = findHotspot(b.hotspot); if (h) S.moved[h.k] = { x: +evalValue(b.x), y: +evalValue(b.y) }; render(); break; }
      case 'give': if (!S.inventory.includes(b.item)) S.inventory.push(b.item); toast('Got: ' + itemDef(b.item).label); render(); break;
      case 'take': S.inventory = S.inventory.filter(i => i !== b.item); if (S.selectedItem === b.item) S.selectedItem = null; render(); break;
      case 'background': S.bg[S.scene] = { image: b.image || '', color: b.color || '' }; render(); break;
      case 'beep': beep(+evalValue(b.freq) || 440, +evalValue(b.ms) || 120); break;
      case 'end': S.ended = String(evalValue(b.text) || 'The End'); render(); break;
      case 'restart': restart(); break;
      case 'call': { const fn = (G.functions || []).find(f => f.id === b.fn); if (fn && depth < 32) { depth++; try { await runBlocks(fn.blocks || []); } finally { depth--; } } break; }
    }
  }
  function findHotspot(id) { const h = scene().hotspots.find(h => h.id === id); return h ? { h, k: key(h) } : null; }
  const queue = [];
  async function trigger(when) {
    const scripts = [...(scene().scripts || []), ...(G.globalScripts || [])].filter(s => matches(s.when, when));
    if (!scripts.length) return false;
    if (S.busy) { queue.push(when); return true; }
    S.busy = true;
    try { for (const s of scripts) await runBlocks(s.blocks); }
    finally { S.busy = false; render(); if (queue.length) trigger(queue.shift()); }
    return true;
  }
  function matches(a, b) {
    if (!a || a.type !== b.type) return false;
    if (a.type === 'tap') return a.hotspot === b.hotspot;
    if (a.type === 'use') return a.item === b.item && a.hotspot === b.hotspot;
    if (a.type === 'button') return a.button === b.button;
    return true;
  }
  async function runSceneStart() {
    const scripts = (scene().scripts || []).filter(s => s.when && s.when.type === 'start');
    for (const s of scripts) await runBlocks(s.blocks);
  }
  function restart() {
    Object.assign(S, { scene: G.start || (G.scenes[0] && G.scenes[0].id) || '', vars: Object.assign({}, G.vars || {}), inventory: [], vis: {}, moved: {}, bg: {}, dialog: null, choices: null, picture: null, selectedItem: null, ended: null, focusHotspot: 0 });
    waiter = null; queue.length = 0; render();
    setTimeout(() => trigger({ type: 'start' }), 50);
  }

  // ---------------------------------------------------------------- input (authority side)
  function tapHotspot(id) {
    if (S.ended) { restart(); return; }
    if (S.dialog || S.picture) { resume('advance'); return; }
    if (S.choices) return;
    if (S.selectedItem) { const it = S.selectedItem; S.selectedItem = null; render(); trigger({ type: 'use', item: it, hotspot: id }).then(ran => { if (!ran) toast("That doesn't work here."); }); return; }
    trigger({ type: 'tap', hotspot: id });
  }
  function advance() { if (S.ended) { restart(); return; } if (S.dialog || S.picture) resume('advance'); }
  function choose(i) { if (S.choices && S.choices.options[i] != null) resume('choice', i); }
  function selectItem(id) { if (S.dialog || S.choices || S.picture) return; S.selectedItem = S.selectedItem === id ? null : id; render(); }
  function button(name, down) {
    if (!down) return;
    if (S.ended) { restart(); return; }
    if (S.choices) {
      const n = S.choices.options.length;
      if (name === 'UP') S.focusChoice = (S.focusChoice - 1 + n) % n;
      else if (name === 'DOWN') S.focusChoice = (S.focusChoice + 1) % n;
      else if (name === 'A') { choose(S.focusChoice); return; }
      render(); return;
    }
    if (S.dialog || S.picture) { if (name === 'A' || name === 'B') advance(); return; }
    const hs = visibleHotspots();
    if (name === 'LEFT' || name === 'UP') S.focusHotspot = (S.focusHotspot - 1 + hs.length) % Math.max(1, hs.length);
    else if (name === 'RIGHT' || name === 'DOWN') S.focusHotspot = (S.focusHotspot + 1) % Math.max(1, hs.length);
    else if (name === 'A') { const h = hs[S.focusHotspot]; if (h) tapHotspot(h.id); return; }
    else if (name === 'B') { S.selectedItem = null; }
    else if (name === 'L1' || name === 'R1') { const inv = S.inventory; if (inv.length) { const i = inv.indexOf(S.selectedItem); S.selectedItem = inv[(i + (name === 'R1' ? 1 : -1) + inv.length) % inv.length]; } }
    else { trigger({ type: 'button', button: name }); return; }
    render();
  }
  window.ThorInput = {
    button(name, down) { if (isTop) button(name, down); else send({ __adv: 'button', name, down }); },
    axes() {},
  };
  const KEY_MAP = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', z: 'A', x: 'B', q: 'L1', e: 'R1', Enter: 'A', ' ': 'A' };
  window.addEventListener('keydown', (e) => { const n = KEY_MAP[e.key]; if (n && !e.repeat) { window.ThorInput.button(n, true); e.preventDefault(); } });

  // ---------------------------------------------------------------- audio
  let actx = null;
  function beep(freq, ms) {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000); } catch (e) {}
    if (isTop && dual()) send({ __adv: 'beep', freq, ms });
  }
  let toastTimer = null, toastText = '';
  function toast(t) { toastText = t; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastText = ''; render(); }, 1800); render(); }

  // ---------------------------------------------------------------- messaging between screens
  window.onThorMessage = function (m) {
    if (!m || !m.__adv) return;
    if (isTop) {
      if (m.__adv === 'button') button(m.name, m.down);
      else if (m.__adv === 'hello') render();
      else if (m.__adv === 'advance') advance();
      else if (m.__adv === 'choose') choose(m.i);
      else if (m.__adv === 'select') selectItem(m.id);
    } else {
      if (m.__adv === 'snap') { Object.assign(R, m.state); renderBottom(); }
      else if (m.__adv === 'beep') beep(m.freq, m.ms);
    }
  };
  let R = { dialog: null, choices: null, inventory: [], selectedItem: null, focusChoice: 0, ended: null, toast: '', items: G.items || [] };
  function snapshot() {
    return { dialog: S.dialog ? { who: S.dialog.who, text: S.dialog.text } : null, choices: S.choices, inventory: S.inventory, selectedItem: S.selectedItem, focusChoice: S.focusChoice, ended: S.ended, toast: toastText, picture: S.picture ? 1 : 0 };
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    if (isTop) { renderTop(); if (dual()) send({ __adv: 'snap', state: snapshot() }); }
    else renderBottom();
  }
  function renderTop() {
    const sc = scene(); const bg = S.bg[sc.id] || sc.background || {};
    let html = `<div class="bg" style="background-color:${esc(bg.color || '#222')};${bg.image ? `background-image:url('${esc(mediaUrl(bg.image))}')` : ''}"></div>`;
    const hs = visibleHotspots();
    hs.forEach((h, i) => {
      const mv = S.moved[key(h)] || h; const focused = i === S.focusHotspot && !S.dialog && !S.choices;
      const style = `left:${mv.x - h.w / 2}px;top:${mv.y - h.h / 2}px;width:${h.w}px;height:${h.h}px;background:${h.image ? 'transparent' : esc(h.color || 'rgba(255,255,255,.15)')};${h.outline === false ? '' : ''}`;
      html += `<div class="hs${focused ? ' focus' : ''}" data-h="${esc(h.id)}" style="${style}">${h.image ? `<img src="${esc(mediaUrl(h.image))}" alt="">` : ''}${focused ? `<span class="lbl">${esc(h.label || h.id)}</span>` : ''}</div>`;
    });
    if (S.dialog && S.dialog.hotspot) {
      const h = sc.hotspots.find(x => x.id === S.dialog.hotspot);
      if (h) { const mv = S.moved[key(h)] || h; const bx = Math.max(20, Math.min(1920 - 720, mv.x - h.w / 2 - 50)), by = Math.max(20, mv.y - h.h / 2 - 170); html += `<div class="bubble" style="left:${bx}px;top:${by}px">${esc(S.dialog.text)}</div>`; }
    }
    if (S.picture) html += `<div class="picture">${S.picture.image ? `<img src="${esc(mediaUrl(S.picture.image))}" alt="">` : ''}${S.picture.caption ? `<div class="cap">${esc(S.picture.caption)}</div>` : ''}</div>`;
    if (!dual()) html += panelHtml(snapshot(), false);
    if (toastText && !dual()) html += `<div class="toast">${esc(toastText)}</div>`;
    if (S.ended) html += `<div class="end">${esc(S.ended)}</div>`;
    stage.innerHTML = html;
  }
  function renderBottom() {
    let html = panelHtml(R, true);
    if (R.toast) html += `<div class="toast">${esc(R.toast)}</div>`;
    if (R.ended) html += `<div class="end" style="font-size:60px">${esc(R.ended)}<br><small style="font-size:30px">tap to play again</small></div>`;
    stage.innerHTML = html;
  }
  function panelHtml(st, bottomScreen) {
    let html = `<div class="panel${bottomScreen ? ' bottomScreen' : ''}">`;
    if (st.choices) {
      html += `<div class="dlg"><div class="who">${esc(st.choices.question)}</div><div class="choices">${st.choices.options.map((o, i) => `<div class="choice${i === st.focusChoice ? ' focus' : ''}" data-c="${i}">${esc(o)}</div>`).join('')}</div></div>`;
    } else if (st.dialog) {
      html += `<div class="dlg" data-adv="1">${st.dialog.who ? `<div class="who">${esc(st.dialog.who)}</div>` : ''}${esc(st.dialog.text)}<div class="hint">tap / A to continue ▶</div></div>`;
    } else if (st.picture) {
      html += `<div class="dlg" data-adv="1"><div class="hint">tap / A to close ▶</div></div>`;
    } else if (bottomScreen) {
      html += `<div class="dlg" style="opacity:.6;border-color:#444"><div class="hint" style="text-align:left">Tap things on the top screen. Select an item below, then tap something to use it.</div></div>`;
    }
    html += `<div class="inv"><span class="title">Items</span>${(st.inventory || []).map(id => { const d = itemDef(id); return `<div class="item${st.selectedItem === id ? ' sel' : ''}" data-i="${esc(id)}">${d.image ? `<img src="${esc(mediaUrl(d.image))}" alt="">` : esc(d.label || id)}</div>`; }).join('') || '<span style="color:#666;font-size:26px">none yet</span>'}</div></div>`;
    return html;
  }

  // taps
  stage.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-h],[data-c],[data-i],[data-adv],.picture,.end');
    if (isTop) {
      if (S.ended) { restart(); return; }
      if (!t) { if (S.dialog || S.picture) advance(); return; }
      if (t.dataset.h) tapHotspot(t.dataset.h);
      else if (t.dataset.c != null) choose(+t.dataset.c);
      else if (t.dataset.i) selectItem(t.dataset.i);
      else advance();
    } else {
      if (R.ended) { send({ __adv: 'advance' }); return; }
      if (!t) { send({ __adv: 'advance' }); return; }
      if (t.dataset.c != null) send({ __adv: 'choose', i: +t.dataset.c });
      else if (t.dataset.i) send({ __adv: 'select', id: t.dataset.i });
      else send({ __adv: 'advance' });
    }
    if (actx && actx.state === 'suspended') actx.resume();
  });

  // ---------------------------------------------------------------- boot
  window.Thor = { state: S, game: G, restart, trigger, button: (n) => button(n, true) };
  render();
  if (isTop) setTimeout(() => trigger({ type: 'start' }), 100);
  else send({ __adv: 'hello' }); // ask the top screen for its current state (we may have loaded after it)
})();
