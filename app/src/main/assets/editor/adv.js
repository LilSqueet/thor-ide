/* Thor IDE — Scratch-style block editor for point-and-click adventures (adventure.json).
 * Everything is tap-driven: blocks are added from a palette, parameters are white chips you tap,
 * text is typed on a built-in keyboard, scenes are laid out by dragging hotspots in a preview.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const H = () => window.ThorBlocksHost;
  const isVideo = (p) => /\.(mp4|webm|mov|3gp|m4v)$/i.test(p || '');
  const COLORS = ['#3dd6c6', '#f5b942', '#ff6b6b', '#c792ea', '#82aaff', '#c3e88d', '#ffffff', '#8b5a2b', '#2b3a4a', '#1a1410', '#101418', '#3a5f3a'];
  const OPS = ['=', '!=', '<', '>', '<=', '>='];
  const BUTTONS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'START', 'SELECT'];

  // ------------------------------------------------------------ block definitions (Scratch-like categories)
  // param kinds: text, value, hotspot, who, scene, var, item, media, number, cond, color, button
  const CATS = {
    looks:   { name: 'Looks',     color: '#9966ff' },
    control: { name: 'Control',   color: '#ffab19' },
    scene:   { name: 'Scenes',    color: '#4c97ff' },
    vars:    { name: 'Variables', color: '#ff8c1a' },
    items:   { name: 'Items',     color: '#59c059' },
    sound:   { name: 'Sound',     color: '#cf63cf' },
  };
  const BLOCKS = {
    say:         { cat: 'looks',   tpl: ['say', ['text', 'text'], 'from', ['who', 'who']] },
    picture:     { cat: 'looks',   tpl: ['show picture', ['image', 'media'], 'caption', ['caption', 'text']] },
    hidePicture: { cat: 'looks',   tpl: ['hide picture'] },
    background:  { cat: 'looks',   tpl: ['change background to', ['image', 'media']] },
    choice:      { cat: 'control', tpl: ['ask', ['question', 'text']], c: 'choice' },
    if:          { cat: 'control', tpl: ['if', ['cond', 'cond']], c: 'if' },
    wait:        { cat: 'control', tpl: ['wait', ['seconds', 'value'], 'seconds'] },
    end:         { cat: 'control', tpl: ['end game with', ['text', 'text']] },
    restart:     { cat: 'control', tpl: ['restart game'] },
    goto:        { cat: 'scene',   tpl: ['go to scene', ['scene', 'scene']] },
    showHotspot: { cat: 'scene',   tpl: ['show', ['hotspot', 'hotspot']] },
    hideHotspot: { cat: 'scene',   tpl: ['hide', ['hotspot', 'hotspot']] },
    moveHotspot: { cat: 'scene',   tpl: ['move', ['hotspot', 'hotspot'], 'to x', ['x', 'value'], 'y', ['y', 'value']] },
    set:         { cat: 'vars',    tpl: ['set', ['name', 'var'], 'to', ['value', 'value']] },
    change:      { cat: 'vars',    tpl: ['change', ['name', 'var'], 'by', ['value', 'value']] },
    give:        { cat: 'items',   tpl: ['give item', ['item', 'item']] },
    take:        { cat: 'items',   tpl: ['take away item', ['item', 'item']] },
    beep:        { cat: 'sound',   tpl: ['beep', ['freq', 'value'], 'Hz for', ['ms', 'value'], 'ms'] },
  };
  const TRIGGERS = {
    start:  { label: 'when scene starts', params: [] },
    tap:    { label: 'when [hotspot] is tapped', params: [['hotspot', 'hotspot']] },
    use:    { label: 'when [item] is used on [hotspot]', params: [['item', 'item'], ['hotspot', 'hotspot']] },
    button: { label: 'when button [A] is pressed', params: [['button', 'button']] },
  };
  const CONDS = {
    var:     { label: 'variable … compared to …', params: [['name', 'var'], ['op', 'op'], ['value', 'value']] },
    has:     { label: 'player has item …', params: [['item', 'item']] },
    nothas:  { label: 'player does NOT have item …', params: [['item', 'item']] },
    visible: { label: 'hotspot … is visible', params: [['hotspot', 'hotspot']] },
    chance:  { label: 'random chance of … %', params: [['percent', 'value']] },
  };
  const DEFAULTS = { text: { s: 'Hello!' }, value: { n: 1 }, who: 'narrator', op: '=', button: 'A', media: '', color: '#3dd6c6' };

  // ------------------------------------------------------------ state
  let game = null, project = null, panel = 'scenes', curScene = null, selHotspot = null, dirtyTimer = null;
  const host = document.createElement('div'); host.id = 'blocks';
  const api = window.ThorBlocks = {};
  api.element = host;
  api.isOpen = () => !!game;
  api.close = () => { game = null; };
  api.open = function (proj, json) {
    project = proj;
    try { game = JSON.parse(json); } catch (e) { game = null; }
    if (!game || !game.scenes) game = newGame();
    game.vars = game.vars || {}; game.items = game.items || []; game.globalScripts = game.globalScripts || [];
    for (const sc of game.scenes) { sc.hotspots = sc.hotspots || []; sc.scripts = sc.scripts || []; sc.background = sc.background || { color: '#2b3a4a', image: '' }; }
    if (!game.scenes.find(s => s.id === curScene)) curScene = game.start || (game.scenes[0] && game.scenes[0].id);
    render();
  };
  function newGame() {
    return { start: 'start', vars: {}, items: [], globalScripts: [], scenes: [{ id: 'start', name: 'Start', background: { color: '#2b3a4a', image: '' }, hotspots: [], scripts: [{ when: { type: 'start' }, blocks: [{ type: 'say', text: { s: 'Welcome to my adventure!' }, who: 'narrator' }] }] }] };
  }
  function save() { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => H() && H().save('adventure.json', JSON.stringify(game, null, 2)), 400); }
  const sceneObj = () => game.scenes.find(s => s.id === curScene) || game.scenes[0];
  const sceneIds = () => game.scenes.map(s => s.id);
  const hotspotIds = () => (sceneObj() ? sceneObj().hotspots.map(h => h.id) : []);
  const varNames = () => Object.keys(game.vars);
  const itemIds = () => game.items.map(i => i.id);
  function uid(base, taken) { let i = 1, id = base; while (taken.includes(id)) id = base + (++i); return id; }
  const slug = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);

  // ------------------------------------------------------------ generated files
  api.generate = function (engineSrc) {
    const page = (screen) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${esc(project)} (${screen})</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}</style>
</head><body>
<!-- Generated by Thor IDE from adventure.json. Edit in Blocks mode; this file is overwritten on Run. -->
<script>window.GAME = ${JSON.stringify(game)};</script>
<script src="adventure.js"></script>
</body></html>
`;
    return { 'index.html': page('top'), 'bottom.html': page('bottom'), 'adventure.js': engineSrc };
  };

  // ------------------------------------------------------------ rendering
  function render() {
    if (!game) return;
    const tabs = [['scenes', 'Scenes'], ['blocks', 'Blocks'], ['vars', 'Variables'], ['items', 'Items']];
    host.innerHTML = `<div class="bk-tabs">${tabs.map(([k, n]) => `<button class="bk-tab${panel === k ? ' on' : ''}" data-p="${k}">${n}</button>`).join('')}<span class="bk-hint">L1 / R1 switch tabs · D-pad moves · A selects · B back</span></div><div class="bk-body" id="bkBody"></div>`;
    host.querySelectorAll('.bk-tab').forEach(b => b.onclick = () => { panel = b.dataset.p; render(); });
    const body = host.querySelector('#bkBody');
    ({ scenes: renderScenes, blocks: renderBlocks, vars: renderVars, items: renderItems })[panel](body);
  }
  api.nextPanel = (d) => { const ps = ['scenes', 'blocks', 'vars', 'items']; panel = ps[(ps.indexOf(panel) + d + 4) % 4]; render(); };

  // ---- scene chooser row (shared by Scenes and Blocks panels)
  function sceneBar(body, extra) {
    const row = document.createElement('div'); row.className = 'bk-row bk-scenebar';
    row.innerHTML = `<span class="bk-lbl">scene</span>${game.scenes.map(s => `<button data-s="${esc(s.id)}" class="${s.id === curScene ? 'acc' : ''}">${esc(s.name || s.id)}${s.id === game.start ? ' ★' : ''}</button>`).join('')}${extra || ''}`;
    row.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { curScene = b.dataset.s; selHotspot = null; render(); });
    body.appendChild(row);
  }

  // ---- scenes
  function renderScenes(body) {
    body.innerHTML = '';
    sceneBar(body, '<button id="addScene" class="bk-mini">+ new scene</button>');
    body.querySelector('#addScene').onclick = () => askText('Scene name', 'Room', (n) => { if (!n) return; const id = uid(slug(n) || 'scene', sceneIds()); game.scenes.push({ id, name: n, background: { color: '#2b3a4a', image: '' }, hotspots: [], scripts: [] }); curScene = id; save(); render(); });
    const sc = sceneObj(); if (!sc) return;
    // scene card: name, start, background, preview
    const card = document.createElement('div'); card.className = 'bk-card';
    card.innerHTML = `<div class="bk-row"><button class="bk-name" data-k="rename">${esc(sc.name || sc.id)}</button>
        <button data-k="start" class="${game.start === sc.id ? 'acc' : ''}">${game.start === sc.id ? '★ start scene' : 'make start scene'}</button>
        <span class="bk-sp"></span><button data-k="dup">copy</button><button data-k="del" class="bk-danger">✕</button></div>
      <div class="bk-row"><span class="bk-lbl">background</span>${COLORS.map(c => `<button class="bk-color${!sc.background.image && c === sc.background.color ? ' on' : ''}" data-k="bg" data-c="${c}" style="background:${c}"></button>`).join('')}
        <button data-k="bgimg" class="bk-chip"><small>photo</small> ${sc.background.image ? esc(sc.background.image.replace(/^media\//, '')) : '(none)'}</button>${sc.background.image ? '<button data-k="bgclear">no photo</button>' : ''}</div>
      <div class="bk-preview" id="preview"></div>
      <div class="muted">Tap a thing in the preview to select it, drag to move it.</div>`;
    card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'rename') askText('Scene name', sc.name || sc.id, (n) => { if (n) { sc.name = n; save(); render(); } });
      else if (k === 'start') { game.start = sc.id; save(); render(); }
      else if (k === 'dup') { const c = JSON.parse(JSON.stringify(sc)); c.id = uid(sc.id, sceneIds()); c.name = (sc.name || sc.id) + ' copy'; game.scenes.push(c); curScene = c.id; save(); render(); }
      else if (k === 'del') { if (game.scenes.length === 1) { H().toast('You need at least one scene'); return; } confirmModal('Delete scene ' + (sc.name || sc.id) + '?', () => { game.scenes = game.scenes.filter(s => s !== sc); if (game.start === sc.id) game.start = game.scenes[0].id; curScene = game.scenes[0].id; save(); render(); }); }
      else if (k === 'bg') { sc.background.color = b.dataset.c; sc.background.image = ''; save(); render(); }
      else if (k === 'bgimg') mediaPicker((p) => { sc.background.image = p; save(); render(); });
      else if (k === 'bgclear') { sc.background.image = ''; save(); render(); }
    });
    body.appendChild(card);
    renderPreview(card.querySelector('#preview'), sc);
    // hotspots
    const hsTitle = document.createElement('div'); hsTitle.className = 'bk-row'; hsTitle.innerHTML = '<span class="bk-kw">THINGS IN THIS SCENE</span>'; body.appendChild(hsTitle);
    for (const h of sc.hotspots) {
      const c = document.createElement('div'); c.className = 'bk-card' + (selHotspot === h.id ? ' bk-selected' : '');
      c.innerHTML = `<div class="bk-row">${h.image ? `<img class="bk-thumb" src="${esc(H().mediaUrl(h.image))}" alt="">` : `<span class="bk-swatch" style="background:${esc(h.color)}"></span>`}
          <button class="bk-name" data-k="label">${esc(h.label || h.id)}</button>
          <button data-k="img" class="bk-chip"><small>photo</small> ${h.image ? esc(h.image.replace(/^media\//, '')) : '(none)'}</button>${h.image ? '<button data-k="imgclear">no photo</button>' : ''}
          <button data-k="vis" class="${h.visible === false ? 'bk-off' : ''}">${h.visible === false ? 'hidden at start' : 'visible'}</button>
          <span class="bk-sp"></span><button data-k="scripts">blocks ›</button><button data-k="dup">copy</button><button data-k="del" class="bk-danger">✕</button></div>
        <div class="bk-row">${stepper('x', h.x)} ${stepper('y', h.y)} ${stepper('w', h.w)} ${stepper('h', h.h)}</div>
        <div class="bk-row"><span class="bk-lbl">color</span>${COLORS.map(col => `<button class="bk-color${col === h.color ? ' on' : ''}" data-k="color" data-c="${col}" style="background:${col}"></button>`).join('')}</div>`;
      wireStepper(c, (k, v) => { h[k] = v; save(); renderPreview(card.querySelector('#preview'), sc); });
      c.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        const k = b.dataset.k;
        if (k === 'label') askText('Name of this thing', h.label || h.id, (n) => { if (n) { h.label = n; save(); render(); } });
        else if (k === 'img') mediaPicker((p) => { h.image = p; sizeToMedia(h, p); save(); render(); });
        else if (k === 'imgclear') { h.image = ''; save(); render(); }
        else if (k === 'vis') { h.visible = h.visible === false ? true : false; save(); render(); }
        else if (k === 'scripts') { panel = 'blocks'; selHotspot = h.id; render(); }
        else if (k === 'dup') { const d = JSON.parse(JSON.stringify(h)); d.id = uid(h.id, hotspotIds()); d.label = (h.label || h.id) + ' 2'; d.x += 60; sc.hotspots.push(d); save(); render(); }
        else if (k === 'del') confirmModal('Delete ' + (h.label || h.id) + '?', () => { sc.hotspots = sc.hotspots.filter(x => x !== h); save(); render(); });
        else if (k === 'color') { h.color = b.dataset.c; save(); render(); }
      });
      body.appendChild(c);
    }
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ add a thing (door, person, key…)';
    add.onclick = () => askText('What is it called?', 'Door', (n) => { if (!n) return; const id = uid(slug(n) || 'thing', hotspotIds()); sc.hotspots.push({ id, label: n, x: 960, y: 600, w: 200, h: 300, color: COLORS[sc.hotspots.length % 6], image: '', visible: true }); selHotspot = id; save(); render(); });
    body.appendChild(add);
  }
  function sizeToMedia(h, path) {
    const url = H().mediaUrl(path); const done = (nw, nh) => { if (!nw || !nh) return; const k = 360 / Math.max(nw, nh); h.w = Math.round(nw * k); h.h = Math.round(nh * k); save(); render(); };
    if (isVideo(path)) return; const i = new Image(); i.onload = () => done(i.naturalWidth, i.naturalHeight); i.src = url;
  }
  function renderPreview(el, sc) {
    if (!el) return;
    const W = el.clientWidth || 400, k = W / 1920; el.style.height = (1080 * k) + 'px';
    el.innerHTML = `<div class="pv-bg" style="background-color:${esc(sc.background.color)};${sc.background.image ? `background-image:url('${esc(H().mediaUrl(sc.background.image))}')` : ''}"></div>` +
      sc.hotspots.map(h => `<div class="pv-hs${selHotspot === h.id ? ' sel' : ''}${h.visible === false ? ' ghost' : ''}" data-h="${esc(h.id)}" style="left:${(h.x - h.w / 2) * k}px;top:${(h.y - h.h / 2) * k}px;width:${h.w * k}px;height:${h.h * k}px;background:${h.image ? 'transparent' : esc(h.color)}">${h.image ? `<img src="${esc(H().mediaUrl(h.image))}" alt="">` : ''}<span>${esc(h.label || h.id)}</span></div>`).join('');
    el.querySelectorAll('.pv-hs').forEach(d => {
      const h = sc.hotspots.find(x => x.id === d.dataset.h); let drag = null;
      d.addEventListener('pointerdown', (e) => { e.preventDefault(); d.setPointerCapture(e.pointerId); drag = { x0: e.clientX, y0: e.clientY, hx: h.x, hy: h.y, moved: false }; });
      d.addEventListener('pointermove', (e) => { if (!drag) return; const dx = (e.clientX - drag.x0) / k, dy = (e.clientY - drag.y0) / k; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; h.x = Math.round(Math.max(0, Math.min(1920, drag.hx + dx))); h.y = Math.round(Math.max(0, Math.min(1080, drag.hy + dy))); d.style.left = ((h.x - h.w / 2) * k) + 'px'; d.style.top = ((h.y - h.h / 2) * k) + 'px'; });
      d.addEventListener('pointerup', () => { if (!drag) return; const moved = drag.moved; drag = null; selHotspot = h.id; save(); if (moved) render(); else render(); });
    });
  }

  // ---- blocks (scripts)
  function renderBlocks(body) {
    body.innerHTML = '';
    sceneBar(body, `<button data-s="__global" class="${curScene === '__global' ? 'acc' : ''}">everywhere</button>`);
    body.querySelector('[data-s="__global"]').onclick = () => { curScene = '__global'; render(); };
    const scripts = curScene === '__global' ? game.globalScripts : (sceneObj() ? sceneObj().scripts : []);
    const shown = selHotspot ? scripts.filter(s => s.when && (s.when.hotspot === selHotspot)) : scripts;
    if (selHotspot) { const f = document.createElement('div'); f.className = 'bk-row'; f.innerHTML = `<span class="bk-lbl">showing blocks for</span><button class="acc">${esc(selHotspot)}</button><button id="showAll">show all</button>`; f.querySelector('#showAll').onclick = () => { selHotspot = null; render(); }; body.appendChild(f); }
    shown.forEach((script) => body.appendChild(renderScript(script, scripts)));
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ new script (when…)';
    add.onclick = () => pickTrigger((when) => { scripts.push({ when, blocks: [] }); save(); render(); });
    body.appendChild(add);
  }
  function triggerLabel(w) {
    switch (w.type) {
      case 'start': return 'when scene starts';
      case 'tap': return 'when ' + (hotspotName(w.hotspot)) + ' is tapped';
      case 'use': return 'when ' + (itemName(w.item)) + ' is used on ' + hotspotName(w.hotspot);
      case 'button': return 'when button ' + w.button + ' is pressed';
    }
    return w.type;
  }
  const hotspotName = (id) => { for (const sc of game.scenes) { const h = sc.hotspots.find(h => h.id === id); if (h) return h.label || h.id; } return id || '?'; };
  const itemName = (id) => { const i = game.items.find(i => i.id === id); return i ? i.label || i.id : (id || '?'); };
  const sceneName = (id) => { const s = game.scenes.find(s => s.id === id); return s ? s.name || s.id : (id || '?'); };
  function pickTrigger(cb) {
    const opts = Object.keys(TRIGGERS).map(k => [k, TRIGGERS[k].label]);
    showModal(`<h3>When should this script run?</h3><div class="list">${opts.map(([k, l]) => `<button data-v="${k}" class="hat-pick">${esc(l)}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); const t = b.dataset.v; const when = { type: t }; fillParams(when, TRIGGERS[t].params, () => cb(when)); });
      $('cl').onclick = closeModal;
    });
  }
  // ask the user for each param in sequence (used when creating a block or trigger)
  function fillParams(obj, params, done) {
    const next = (i) => { if (i >= params.length) return done(); const [k, kind] = params[i]; editParam(obj, k, kind, () => next(i + 1), true); };
    next(0);
  }
  function renderScript(script, list) {
    const wrap = document.createElement('div'); wrap.className = 'scr';
    const hat = document.createElement('div'); hat.className = 'blk hat';
    hat.innerHTML = `<span>${esc(triggerLabel(script.when))}</span><span class="bk-sp"></span><button class="blk-menu" title="script menu">⋮</button>`;
    hat.querySelector('.blk-menu').onclick = () => showModal(`<h3>Script: ${esc(triggerLabel(script.when))}</h3><div class="list"><button id="chg">Change when it runs…</button><button id="dup">Duplicate script</button><button id="del" style="color:var(--err)">Delete script</button></div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('cl').onclick = closeModal;
      $('chg').onclick = () => { closeModal(); pickTrigger((when) => { script.when = when; save(); render(); }); };
      $('dup').onclick = () => { closeModal(); list.push(JSON.parse(JSON.stringify(script))); save(); render(); };
      $('del').onclick = () => { closeModal(); confirmModal('Delete this script?', () => { list.splice(list.indexOf(script), 1); save(); render(); }); };
    });
    wrap.appendChild(hat);
    wrap.appendChild(renderStack(script.blocks = script.blocks || []));
    return wrap;
  }
  function renderStack(blocks) {
    const st = document.createElement('div'); st.className = 'stack';
    blocks.forEach((b, i) => st.appendChild(renderBlock(b, blocks, i)));
    const add = document.createElement('button'); add.className = 'blk-add'; add.textContent = '+';
    add.title = 'add a block'; add.onclick = () => palette((nb) => { blocks.push(nb); save(); render(); });
    st.appendChild(add);
    return st;
  }
  function renderBlock(b, list, i) {
    const def = BLOCKS[b.type]; const cat = def ? CATS[def.cat] : { color: '#888' };
    const el = document.createElement('div'); el.className = 'blk' + (def && def.c ? ' cblk' : ''); el.style.background = cat.color;
    const head = document.createElement('div'); head.className = 'blk-head';
    if (def) for (const part of def.tpl) {
      if (typeof part === 'string') { const s = document.createElement('span'); s.textContent = part; head.appendChild(s); }
      else head.appendChild(chip(b, part[0], part[1]));
    } else { head.textContent = b.type; }
    const menu = document.createElement('button'); menu.className = 'blk-menu'; menu.textContent = '⋮';
    menu.onclick = () => blockMenu(b, list, i);
    head.appendChild(menu);
    el.appendChild(head);
    if (def && def.c === 'if') {
      el.appendChild(label('then')); el.appendChild(renderStack(b.then = b.then || []));
      el.appendChild(label('else')); el.appendChild(renderStack(b.else = b.else || []));
    } else if (def && def.c === 'choice') {
      b.options = b.options || [];
      b.options.forEach((o, oi) => {
        const row = document.createElement('div'); row.className = 'blk-optrow';
        const c = chip(o, 'text', 'text'); c.classList.add('opt'); row.appendChild(label('option ' + (oi + 1) + ':')); row.appendChild(c);
        const rm = document.createElement('button'); rm.className = 'blk-menu'; rm.textContent = '✕'; rm.onclick = () => { b.options.splice(oi, 1); save(); render(); }; row.appendChild(rm);
        el.appendChild(row); el.appendChild(renderStack(o.blocks = o.blocks || []));
      });
      const addOpt = document.createElement('button'); addOpt.className = 'blk-mini'; addOpt.textContent = '+ option';
      addOpt.onclick = () => askText('Choice text', 'Yes', (t) => { if (t) { b.options.push({ text: { s: t }, blocks: [] }); save(); render(); } });
      el.appendChild(addOpt);
    }
    return el;
  }
  function label(t) { const s = document.createElement('div'); s.className = 'blk-sub'; s.textContent = t; return s; }
  function chip(obj, k, kind) {
    const c = document.createElement('button'); c.className = 'chip chip-' + kind;
    c.textContent = chipText(obj[k], kind);
    c.onclick = () => editParam(obj, k, kind, () => { save(); render(); });
    return c;
  }
  function chipText(v, kind) {
    switch (kind) {
      case 'text': case 'value': return vfmt(v);
      case 'who': return v && v !== 'narrator' ? hotspotName(v) : 'narrator';
      case 'hotspot': return hotspotName(v);
      case 'scene': return sceneName(v);
      case 'item': return itemName(v);
      case 'media': return v ? String(v).replace(/^media\//, '') : '(pick photo)';
      case 'cond': return condText(v);
      default: return v == null || v === '' ? '…' : String(v);
    }
  }
  function vfmt(v) {
    if (v == null) return '…'; if (typeof v !== 'object') return String(v);
    if ('s' in v) return v.s === '' ? '…' : v.s; if ('n' in v) return String(v.n); if ('v' in v) return '[' + v.v + ']'; if ('rnd' in v) return 'random ' + v.rnd[0] + '–' + v.rnd[1];
    return '…';
  }
  function condText(c) {
    if (!c) return 'choose…';
    switch (c.type) {
      case 'var': return '[' + c.name + '] ' + c.op + ' ' + vfmt(c.value);
      case 'has': return 'has ' + itemName(c.item);
      case 'nothas': return 'does not have ' + itemName(c.item);
      case 'visible': return hotspotName(c.hotspot) + ' is visible';
      case 'chance': return vfmt(c.percent) + '% chance';
    }
    return '?';
  }
  function blockMenu(b, list, i) {
    showModal(`<h3>Block</h3><div class="list"><button id="up">Move up</button><button id="down">Move down</button><button id="ins">Insert a block above</button><button id="dup">Duplicate</button><button id="del" style="color:var(--err)">Delete</button></div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('cl').onclick = closeModal;
      $('up').onclick = () => { closeModal(); if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); render(); } };
      $('down').onclick = () => { closeModal(); if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); save(); render(); } };
      $('ins').onclick = () => { closeModal(); palette((nb) => { list.splice(i, 0, nb); save(); render(); }); };
      $('dup').onclick = () => { closeModal(); list.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); save(); render(); };
      $('del').onclick = () => { closeModal(); list.splice(i, 1); save(); render(); };
    });
  }
  // palette: pick a block, then fill in its parameters one by one
  function palette(cb) {
    const groups = Object.keys(CATS).map(cat => `<div class="pal-cat" style="border-color:${CATS[cat].color}"><div class="pal-title" style="color:${CATS[cat].color}">${CATS[cat].name}</div>${Object.keys(BLOCKS).filter(k => BLOCKS[k].cat === cat).map(k => `<button data-v="${k}" class="pal-blk" style="background:${CATS[cat].color}">${esc(BLOCKS[k].tpl.map(p => typeof p === 'string' ? p : '[' + p[0] + ']').join(' '))}</button>`).join('')}</div>`).join('');
    showModal(`<h3>Add a block</h3><div class="pal">${groups}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('cl').onclick = closeModal;
      $('modalBox').querySelectorAll('[data-v]').forEach(btn => btn.onclick = () => {
        closeModal(); const t = btn.dataset.v, def = BLOCKS[t]; const nb = { type: t };
        if (def.c === 'if') { nb.then = []; nb.else = []; } if (def.c === 'choice') nb.options = [{ text: { s: 'Yes' }, blocks: [] }, { text: { s: 'No' }, blocks: [] }];
        const params = def.tpl.filter(p => typeof p !== 'string');
        fillParams(nb, params, () => cb(nb));
      });
    });
  }
  // parameter editors
  function editParam(obj, k, kind, done, creating) {
    const set = (v) => { obj[k] = v; done(); };
    const cur = obj[k];
    switch (kind) {
      case 'text': return askText('Text', cur && cur.s != null ? cur.s : (creating ? (DEFAULTS.text.s) : ''), (t) => set({ s: t }));
      case 'value': return valuePicker(cur, set);
      case 'who': return pick('Who says it?', [['narrator', 'narrator (no bubble)'], ...sceneObj().hotspots.map(h => [h.id, h.label || h.id])], set);
      case 'hotspot': { const hs = (curScene === '__global' ? game.scenes.flatMap(s => s.hotspots) : sceneObj().hotspots); if (!hs.length) { H().toast('Add a thing to the scene first'); return set(''); } return pick('Which thing?', hs.map(h => [h.id, h.label || h.id]), set); }
      case 'scene': return pick('Which scene?', game.scenes.map(s => [s.id, s.name || s.id]), set);
      case 'var': { if (!varNames().length) return askText('New variable name', 'score', (n) => { n = slug(n); if (!n) return; game.vars[n] = 0; set(n); }); return pick('Which variable?', [...varNames().map(v => [v, v]), ['__new', '+ new variable…']], (v) => { if (v === '__new') askText('New variable name', 'score', (n) => { n = slug(n); if (!n) return; game.vars[n] = 0; set(n); }); else set(v); }); }
      case 'item': { if (!itemIds().length) return askText('New item name', 'Key', (n) => { if (!n) return; const id = uid(slug(n) || 'item', itemIds()); game.items.push({ id, label: n, image: '' }); set(id); }); return pick('Which item?', [...game.items.map(i => [i.id, i.label || i.id]), ['__new', '+ new item…']], (v) => { if (v === '__new') askText('New item name', 'Key', (n) => { if (!n) return; const id = uid(slug(n) || 'item', itemIds()); game.items.push({ id, label: n, image: '' }); set(id); }); else set(v); }); }
      case 'media': return mediaPicker(set);
      case 'op': return pick('Compare', OPS.map(o => [o, o]), set);
      case 'button': return pick('Button', BUTTONS.map(b => [b, b]), set);
      case 'cond': return pick('Condition', Object.keys(CONDS).map(c => [c, CONDS[c].label]), (t) => { const c = { type: t }; if (t === 'var') c.op = '='; fillParams(c, CONDS[t].params, () => set(c)); });
    }
    done();
  }
  function valuePicker(cur, cb) {
    const kinds = [
      ['Number', () => keypad(cur && 'n' in cur ? cur.n : 0, (n) => cb({ n }))],
      ['Variable', () => varNames().length ? pick('Variable', varNames().map(v => [v, v]), (v) => cb({ v })) : H().toast('No variables yet')],
      ['Random number', () => keypad(1, (a) => keypad(10, (b) => cb({ rnd: [a, b] })))],
      ['Text', () => askText('Text', cur && 's' in cur ? cur.s : '', (s) => cb({ s }))],
    ];
    showModal(`<h3>Value</h3><div class="list">${kinds.map((k, i) => `<button data-i="${i}">${k[0]}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeModal(); kinds[+b.dataset.i][1](); });
      $('cl').onclick = closeModal;
    });
  }

  // ---- variables
  function renderVars(body) {
    body.innerHTML = '';
    const help = document.createElement('div'); help.className = 'bk-card bk-help'; help.innerHTML = 'Variables remember numbers (a score, how many times you talked to someone, whether a door is unlocked). Use the <b>set</b> / <b>change</b> blocks to change them and <b>if</b> to check them.'; body.appendChild(help);
    for (const name of varNames()) {
      const row = document.createElement('div'); row.className = 'bk-card bk-row';
      row.innerHTML = `<span class="bk-name">${esc(name)}</span><span class="bk-lbl">starts at</span>${stepper('v', +game.vars[name] || 0)}<span class="bk-sp"></span><button data-k="del" class="bk-danger">✕</button>`;
      wireStepper(row, (k, v) => { game.vars[name] = v; save(); });
      row.querySelector('[data-k="del"]').onclick = () => confirmModal('Delete variable ' + name + '?', () => { delete game.vars[name]; save(); render(); });
      body.appendChild(row);
    }
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ new variable';
    add.onclick = () => askText('Variable name', 'score', (n) => { n = slug(n); if (n && !(n in game.vars)) { game.vars[n] = 0; save(); render(); } });
    body.appendChild(add);
  }
  // ---- items
  function renderItems(body) {
    body.innerHTML = '';
    const help = document.createElement('div'); help.className = 'bk-card bk-help'; help.innerHTML = 'Items go in the player\'s inventory on the bottom screen. <b>give item</b> adds one, and a "when [item] is used on [thing]" script runs when the player selects it and taps something.'; body.appendChild(help);
    for (const it of game.items) {
      const row = document.createElement('div'); row.className = 'bk-card bk-row';
      row.innerHTML = `${it.image ? `<img class="bk-thumb" src="${esc(H().mediaUrl(it.image))}" alt="">` : '<span class="bk-swatch" style="background:#59c059"></span>'}<button class="bk-name" data-k="label">${esc(it.label || it.id)}</button><button data-k="img" class="bk-chip"><small>photo</small> ${it.image ? esc(it.image.replace(/^media\//, '')) : '(none)'}</button><span class="bk-sp"></span><button data-k="del" class="bk-danger">✕</button>`;
      row.querySelector('[data-k="label"]').onclick = () => askText('Item name', it.label || it.id, (n) => { if (n) { it.label = n; save(); render(); } });
      row.querySelector('[data-k="img"]').onclick = () => mediaPicker((p) => { it.image = p; save(); render(); });
      row.querySelector('[data-k="del"]').onclick = () => confirmModal('Delete item ' + (it.label || it.id) + '?', () => { game.items = game.items.filter(x => x !== it); save(); render(); });
      body.appendChild(row);
    }
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ new item';
    add.onclick = () => askText('Item name', 'Key', (n) => { if (!n) return; game.items.push({ id: uid(slug(n) || 'item', itemIds()), label: n, image: '' }); save(); render(); });
    body.appendChild(add);
  }

  // ------------------------------------------------------------ media
  let importCb = null;
  function mediaPicker(cb) {
    const list = H().mediaFiles();
    showModal(`<h3>Photo / GIF / video</h3><div class="bk-media">${list.map(f => `<button data-v="${esc(f)}" class="bk-mediabtn">${isVideo(f) ? `<video src="${esc(H().mediaUrl(f))}" muted playsinline></video>` : `<img src="${esc(H().mediaUrl(f))}" alt="">`}<span>${esc(f.replace(/^media\//, ''))}</span></button>`).join('') || '<p class="muted">No photos in this project yet.</p>'}</div>
      <div class="row"><button id="imp" class="acc">Import from device…</button><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.v); });
      $('imp').onclick = () => { closeModal(); importCb = cb; H().importMedia(); };
      $('cl').onclick = closeModal;
    });
  }
  api.onImported = (path) => { const cb = importCb; importCb = null; if (cb) cb(path); else render(); };

  // ------------------------------------------------------------ widgets
  function stepper(k, v) { return `<span class="bk-step" data-step="${k}"><small>${k}</small><button data-d="-10">−10</button><button data-d="-1">−</button><button class="bk-num" data-d="0">${v}</button><button data-d="1">+</button><button data-d="10">+10</button></span>`; }
  function wireStepper(root, onChange) {
    root.querySelectorAll('.bk-step').forEach(st => {
      const k = st.dataset.step, num = st.querySelector('.bk-num');
      st.querySelectorAll('button').forEach(b => b.onclick = () => { const d = +b.dataset.d; if (d === 0) keypad(+num.textContent, (v) => { num.textContent = v; onChange(k, v); }); else { const v = (+num.textContent || 0) + d; num.textContent = v; onChange(k, v); } });
    });
  }
  function showModal(html, wire) { $('modalBox').innerHTML = html; $('modal').classList.add('on'); wire && wire(); setTimeout(() => { const f = $('modalBox').querySelector('input, button'); f && f.focus(); }, 0); }
  function closeModal() { $('modal').classList.remove('on'); }
  api.closeModal = () => { if ($('modal').classList.contains('on')) { closeModal(); return true; } return false; };
  function pick(title, options, cb) {
    showModal(`<h3>${esc(title)}</h3><div class="list bk-picklist">${options.map(([v, l]) => `<button data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.v); });
      $('cl').onclick = closeModal;
    });
  }
  function confirmModal(msg, cb) {
    showModal(`<h3>${esc(msg)}</h3><div class="row"><button id="ok" style="color:var(--err)">Yes</button><button id="cl">Cancel</button></div>`, () => { $('cl').onclick = closeModal; $('ok').onclick = () => { closeModal(); cb(); }; });
  }
  function keypad(start, cb) {
    let s = String(start ?? 0), fresh = true;
    showModal(`<h3>Number</h3><div class="bk-keypad"><div class="bk-kpv" id="kpv">${esc(s)}</div>${['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '0', '.'].map(k => `<button data-kp="${k}">${k}</button>`).join('')}<button data-kp="bs">⌫</button><button data-kp="clr">C</button><button data-kp="ok" class="acc">OK</button></div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-kp]').forEach(b => b.onclick = () => { const k = b.dataset.kp; if (k === 'ok') { closeModal(); cb(+s || 0); return; } if (k === 'bs') s = s.slice(0, -1); else if (k === 'clr') s = ''; else if (k === '-') s = s.startsWith('-') ? s.slice(1) : '-' + s; else { if (fresh) s = ''; s += k; } fresh = false; $('kpv').textContent = s || '0'; });
      $('cl').onclick = closeModal;
    });
  }
  // text entry with a built-in keyboard (the Android keyboard may not appear on the bottom screen)
  const KROWS = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"], ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'], ['!?', 'space', '⌫']];
  const SYM = { '1': '!', '2': '?', '3': '"', '4': ':', '5': ';', '6': '(', '7': ')', '8': '-', '9': '&', '0': '…', ',': '<', '.': '>' };
  function askText(title, value, cb) {
    let shift = false, sym = false;
    showModal(`<h3>${esc(title)}</h3><input id="av" autocomplete="off"><div class="tk" id="tk"></div><div class="row"><button id="ok" class="acc">OK</button><button id="cl">Cancel</button></div>`, () => {
      const inp = $('av'); inp.value = value || ''; inp.focus(); inp.select();
      const kb = $('tk');
      const build = () => {
        kb.innerHTML = KROWS.map(r => `<div class="tk-row">${r.map(k => { let t = k; if (k.length === 1) t = sym ? (SYM[k] || k) : shift ? k.toUpperCase() : k; return `<button data-k="${esc(k)}" class="tk-k${k === 'space' ? ' tk-space' : ''}${(k === '⇧' && shift) || (k === '!?' && sym) ? ' on' : ''}">${k === 'space' ? '' : esc(t)}</button>`; }).join('')}</div>`).join('');
        kb.querySelectorAll('.tk-k').forEach(b => b.addEventListener('pointerdown', (e) => { e.preventDefault(); const k = b.dataset.k; if (k === '⇧') { shift = !shift; build(); return; } if (k === '!?') { sym = !sym; build(); return; } if (k === '⌫') { inp.value = inp.value.slice(0, -1); return; } if (k === 'space') { inp.value += ' '; return; } let ch = sym ? (SYM[k] || k) : shift ? k.toUpperCase() : k; inp.value += ch; if (shift) { shift = false; build(); } }));
      };
      build();
      $('cl').onclick = closeModal; $('ok').onclick = () => { const v = inp.value.trim(); closeModal(); cb(v); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ok').onclick(); });
    });
  }
})();
