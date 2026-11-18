/* Thor IDE — block (event sheet) editor.
 * Tap-only: every value is picked from a list, a stepper or a keypad. Navigable with the D-pad / A / B.
 * Edits game.json; Run generates index.html / bottom.html / engine.js for the engine.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const BUTTONS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'START', 'SELECT'];
  const PROPS = ['x', 'y', 'w', 'h', 'vx', 'vy', 'angle', 'size'];
  const SHAPES = ['rect', 'circle', 'triangle', 'text'];
  const COLORS = ['#3dd6c6', '#f5b942', '#ff6b6b', '#c792ea', '#82aaff', '#c3e88d', '#ffffff', '#1b1f2a'];
  const OPS = ['=', '!=', '<', '>', '<=', '>='];

  // ------------------------------------------------------------ schemas
  // param kinds: sprite, number, value, text, button, prop, screen, shape, color, op, var, name, phase, target, seconds
  const TRIGGERS = {
    start:    { label: 'Game starts', params: [] },
    frame:    { label: 'Every frame', params: [] },
    button:   { label: 'Button', params: [['button', 'button'], ['phase', 'phase']], fmt: (w) => `Button ${w.button} ${w.phase}` },
    tap:      { label: 'Tap', params: [['target', 'target']], fmt: (w) => `Tap on ${w.target}` },
    touching: { label: 'Sprites touch', params: [['a', 'sprite'], ['b', 'sprite']], fmt: (w) => `${w.a} touches ${w.b}` },
    every:    { label: 'Every N seconds', params: [['seconds', 'value']], fmt: (w) => `Every ${vfmt(w.seconds)} s` },
    offscreen:{ label: 'Sprite leaves screen', params: [['sprite', 'sprite']], fmt: (w) => `${w.sprite} leaves screen` },
    message:  { label: 'Message received', params: [['name', 'name']], fmt: (w) => `Message "${w.name}"` },
  };
  const CONDS = {
    var:      { label: 'Variable compare', params: [['name', 'var'], ['op', 'op'], ['value', 'value']], fmt: (c) => `${c.name} ${c.op} ${vfmt(c.value)}` },
    prop:     { label: 'Sprite property compare', params: [['sprite', 'sprite'], ['prop', 'prop'], ['op', 'op'], ['value', 'value']], fmt: (c) => `${c.sprite}.${c.prop} ${c.op} ${vfmt(c.value)}` },
    touching: { label: 'Sprites touching', params: [['a', 'sprite'], ['b', 'sprite']], fmt: (c) => `${c.a} touching ${c.b}` },
    held:     { label: 'Button held', params: [['button', 'button']], fmt: (c) => `${c.button} held` },
    visible:  { label: 'Sprite visible', params: [['sprite', 'sprite']], fmt: (c) => `${c.sprite} visible` },
    chance:   { label: 'Chance %', params: [['percent', 'value']], fmt: (c) => `${vfmt(c.percent)}% chance` },
    offscreen:{ label: 'Sprite off screen', params: [['sprite', 'sprite']], fmt: (c) => `${c.sprite} off screen` },
  };
  const ACTIONS = {
    move:        { label: 'Move by', params: [['sprite', 'sprite'], ['dx', 'value'], ['dy', 'value']] },
    moveto:      { label: 'Move to x,y', params: [['sprite', 'sprite'], ['x', 'value'], ['y', 'value']] },
    moveToTouch: { label: 'Move to touch', params: [['sprite', 'sprite']] },
    moveToSprite:{ label: 'Move to sprite', params: [['sprite', 'sprite'], ['target', 'sprite']] },
    set:         { label: 'Set property', params: [['sprite', 'sprite'], ['prop', 'prop'], ['value', 'value']] },
    change:      { label: 'Change property by', params: [['sprite', 'sprite'], ['prop', 'prop'], ['value', 'value']] },
    show:        { label: 'Show', params: [['sprite', 'sprite']] },
    hide:        { label: 'Hide', params: [['sprite', 'sprite']] },
    toggle:      { label: 'Show/hide toggle', params: [['sprite', 'sprite']] },
    say:         { label: 'Set text', params: [['sprite', 'sprite'], ['text', 'value']] },
    color:       { label: 'Set color', params: [['sprite', 'sprite'], ['color', 'color']] },
    screen:      { label: 'Move to screen', params: [['sprite', 'sprite'], ['screen', 'screen']] },
    home:        { label: 'Back to start position', params: [['sprite', 'sprite']] },
    bounce:      { label: 'Bounce off edges', params: [['sprite', 'sprite']] },
    keepOnScreen:{ label: 'Keep on screen', params: [['sprite', 'sprite']] },
    wrap:        { label: 'Wrap around edges', params: [['sprite', 'sprite']] },
    var_set:     { label: 'Set variable', params: [['name', 'var'], ['value', 'value']] },
    var_change:  { label: 'Change variable by', params: [['name', 'var'], ['value', 'value']] },
    send:        { label: 'Send message', params: [['name', 'name'], ['value', 'value']] },
    beep:        { label: 'Beep', params: [['freq', 'value'], ['ms', 'value']] },
    log:         { label: 'Log to console', params: [['text', 'value']] },
    restart:     { label: 'Restart game', params: [] },
    image:       { label: 'Set photo / video', params: [['sprite', 'sprite'], ['image', 'media']] },
    play:        { label: 'Play video from start', params: [['sprite', 'sprite']] },
    pause:       { label: 'Pause video', params: [['sprite', 'sprite']] },
    if:          { label: 'If … then', params: [], nested: true },
  };
  const isVideo = (p) => /\.(mp4|webm|mov|3gp|m4v)$/i.test(p || '');
  const H = () => window.ThorBlocksHost;
  const DEFAULTS = { media: '', value: { n: 10 }, button: 'A', phase: 'pressed', target: 'top', op: '=', prop: 'x', screen: 'top', shape: 'rect', color: '#3dd6c6', name: 'ping', seconds: { n: 1 } };

  function vfmt(v) {
    if (v == null) return '0';
    if (typeof v !== 'object') return String(v);
    if ('n' in v) return String(v.n);
    if ('s' in v) return '"' + v.s + '"';
    if ('v' in v) return v.v;
    if ('p' in v) return v.p[0] + '.' + v.p[1];
    if ('rnd' in v) return 'random ' + v.rnd[0] + '–' + v.rnd[1];
    if ('stick' in v) return { lx: 'left stick X', ly: 'left stick Y', rx: 'right stick X', ry: 'right stick Y' }[v.stick];
    if ('touchx' in v) return 'touch X';
    if ('touchy' in v) return 'touch Y';
    if ('time' in v) return 'time (s)';
    if ('op' in v) return '(' + vfmt(v.a) + ' ' + v.op + ' ' + vfmt(v.b) + ')';
    return '?';
  }

  // ------------------------------------------------------------ state
  let game = null, project = null, panel = 'sprites', dirtyTimer = null;
  const host = document.createElement('div'); host.id = 'blocks';
  const api = window.ThorBlocks = {};

  api.open = function (proj, json) {
    project = proj;
    try { game = JSON.parse(json); } catch (e) { game = null; }
    if (!game || !game.sprites) game = newGame();
    game.vars = game.vars || {}; game.events = game.events || []; game.background = game.background || { top: '#101418', bottom: '#1a1410' };
    render();
  };
  api.element = host;
  api.isOpen = () => !!game;
  api.close = () => { game = null; };

  function newGame() {
    return { sprites: [{ id: 'player', shape: 'rect', x: 960, y: 900, w: 120, h: 40, color: '#3dd6c6', screen: 'top', visible: true, text: '', size: 48 }], vars: { score: 0 }, events: [], background: { top: '#101418', bottom: '#1a1410' } };
  }
  function save() {
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => { window.ThorBlocksHost && ThorBlocksHost.save('game.json', JSON.stringify(game, null, 2)); }, 400);
  }
  function spriteIds() { return game.sprites.map(s => s.id); }
  function varNames() { return Object.keys(game.vars); }
  function uid(base) { let i = 1, id = base; while (spriteIds().includes(id)) id = base + (++i); return id; }

  // ------------------------------------------------------------ generated files
  api.generate = function (engineSrc) {
    const page = (screen) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${esc(project)} (${screen})</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}canvas{display:block}</style>
</head><body>
<canvas id="game"></canvas>
<!-- Generated by Thor IDE from game.json. Edit game.json in Blocks mode; this file is overwritten on Run. -->
<script>window.GAME = ${JSON.stringify(game)};</script>
<script src="engine.js"></script>
</body></html>
`;
    return { 'index.html': page('top'), 'bottom.html': page('bottom'), 'engine.js': engineSrc };
  };

  // ------------------------------------------------------------ rendering
  function render() {
    if (!game) return;
    host.innerHTML = `
      <div class="bk-tabs">
        ${['sprites', 'events', 'vars', 'settings'].map(p => `<button class="bk-tab${panel === p ? ' on' : ''}" data-p="${p}">${{ sprites: 'Sprites', events: 'Events', vars: 'Variables', settings: 'Screens' }[p]}</button>`).join('')}
        <span class="bk-hint">L1 / R1 switch tabs · D-pad moves · A selects · B back</span>
      </div>
      <div class="bk-body" id="bkBody"></div>`;
    host.querySelectorAll('.bk-tab').forEach(b => b.onclick = () => { panel = b.dataset.p; render(); });
    const body = host.querySelector('#bkBody');
    if (panel === 'sprites') renderSprites(body);
    else if (panel === 'events') renderEvents(body);
    else if (panel === 'vars') renderVars(body);
    else renderSettings(body);
  }
  api.nextPanel = (d) => { const ps = ['sprites', 'events', 'vars', 'settings']; panel = ps[(ps.indexOf(panel) + d + ps.length) % ps.length]; render(); };

  // ---- sprites
  function renderSprites(body) {
    body.innerHTML = '';
    for (const sp of game.sprites) {
      const card = document.createElement('div'); card.className = 'bk-card';
      card.innerHTML = `
        <div class="bk-row">
          ${sp.image ? (isVideo(sp.image) ? `<video class="bk-thumb" src="${esc(H().mediaUrl(sp.image))}" muted loop autoplay playsinline></video>` : `<img class="bk-thumb" src="${esc(H().mediaUrl(sp.image))}" alt="">`) : `<span class="bk-swatch" style="background:${esc(sp.color)}"></span>`}
          <button class="bk-name" data-k="rename">${esc(sp.id)}</button>
          ${sp.image ? `<button data-k="media" class="bk-chip"><small>${sp.shape}</small> ${esc(sp.image.replace(/^media\//, ''))}</button>` : chip('shape', sp.shape)} ${chip('screen', sp.screen)}
          <button data-k="vis" class="${sp.visible ? '' : 'bk-off'}">${sp.visible ? 'visible' : 'hidden'}</button>
          <span class="bk-sp"></span>
          <button data-k="dup">copy</button><button data-k="del" class="bk-danger">✕</button>
        </div>
        <div class="bk-row">
          ${stepper('x', sp.x)} ${stepper('y', sp.y)} ${stepper('w', sp.w)} ${stepper('h', sp.h)}
        </div>
        <div class="bk-row">
          <span class="bk-lbl">color</span>${COLORS.map(c => `<button class="bk-color${c === sp.color ? ' on' : ''}" data-k="color" data-c="${c}" style="background:${c}"></button>`).join('')}
          <span class="bk-lbl">text</span><button data-k="text">${sp.text ? esc(sp.text) : '(none)'}</button> ${stepper('size', sp.size || 48)}
        </div>`;
      wireStepper(card, (k, v) => { sp[k] = v; save(); });
      card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        const k = b.dataset.k;
        if (k === 'rename') askText('Sprite name', sp.id, (v) => { v = v.replace(/[^A-Za-z0-9_]/g, ''); if (!v || v === sp.id || spriteIds().includes(v)) return; renameSprite(sp.id, v); save(); render(); });
        else if (k === 'shape') pick('Shape', SHAPES, (v) => { sp.shape = v; save(); render(); });
        else if (k === 'media') mediaPicker((path) => { applyMedia(sp, path); save(); render(); });
        else if (k === 'screen') pick('Screen', ['top', 'bottom'], (v) => { sp.screen = v; save(); render(); });
        else if (k === 'vis') { sp.visible = !sp.visible; save(); render(); }
        else if (k === 'dup') { const c = JSON.parse(JSON.stringify(sp)); c.id = uid(sp.id); c.x += 40; game.sprites.push(c); save(); render(); }
        else if (k === 'del') confirmModal('Delete sprite ' + sp.id + '?', () => { game.sprites = game.sprites.filter(s => s !== sp); save(); render(); });
        else if (k === 'color') { sp.color = b.dataset.c; save(); render(); }
        else if (k === 'text') askText('Text shown on the sprite', sp.text || '', (v) => { sp.text = v; save(); render(); });
      });
      body.appendChild(card);
    }
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ Add sprite';
    add.onclick = () => pick('New sprite', ['rect', 'circle', 'triangle', 'text', 'photo / GIF / video…'], (shape) => {
      if (shape.startsWith('photo')) { mediaPicker((path) => { const sp = { id: uid(path.replace(/^media\//, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '') || 'pic'), shape: 'image', x: 960, y: 540, w: 300, h: 300, color: '#ffffff', screen: 'top', visible: true, text: '', size: 48 }; applyMedia(sp, path); game.sprites.push(sp); save(); render(); }); return; }
      game.sprites.push({ id: uid(shape), shape, x: shape === 'text' ? 960 : 400, y: 300, w: shape === 'text' ? 400 : 80, h: 80, color: COLORS[game.sprites.length % COLORS.length], screen: 'top', visible: true, text: shape === 'text' ? 'Score: 0' : '', size: 48 });
      save(); render();
    });
    body.appendChild(add);
  }
  function renameSprite(from, to) {
    const sp = game.sprites.find(s => s.id === from); sp.id = to;
    const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { for (const k in o) { if (typeof o[k] === 'string' && o[k] === from && ['sprite', 'a', 'b', 'target'].includes(k)) o[k] = to; else if (k === 'p' && Array.isArray(o[k]) && o[k][0] === from) o[k][0] = to; else walk(o[k]); } } };
    walk(game.events);
  }

  // ---- media (photos, GIFs, videos live in the project's media/ folder)
  function applyMedia(sp, path) {
    sp.image = path; sp.shape = isVideo(path) ? 'video' : 'image';
    // size the sprite to the media's natural aspect (max 400 px on the long side) once it loads
    const url = H().mediaUrl(path);
    const done = (nw, nh) => { if (!nw || !nh) return; const k = 400 / Math.max(nw, nh); sp.w = Math.round(nw * k); sp.h = Math.round(nh * k); save(); render(); };
    if (isVideo(path)) { const v = document.createElement('video'); v.muted = true; v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight); v.src = url; }
    else { const i = new Image(); i.onload = () => done(i.naturalWidth, i.naturalHeight); i.src = url; }
  }
  let importCb = null;
  function mediaPicker(cb) {
    const list = H().mediaFiles();
    showModal(`<h3>Photo / GIF / video</h3><div class="bk-media">${list.map(f => `<button data-v="${esc(f)}" class="bk-mediabtn">${isVideo(f) ? `<video src="${esc(H().mediaUrl(f))}" muted playsinline></video>` : `<img src="${esc(H().mediaUrl(f))}" alt="">`}<span>${esc(f.replace(/^media\//, ''))}</span></button>`).join('') || '<p class="muted">No media in this project yet.</p>'}</div>
      <div class="row"><button id="imp" class="acc">Import from device…</button><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.v); });
      $('imp').onclick = () => { closeModal(); importCb = cb; H().importMedia(); };
      $('cl').onclick = closeModal;
    });
  }
  api.onImported = (path) => { const cb = importCb; importCb = null; if (cb) cb(path); else render(); };

  // ---- events
  function renderEvents(body) {
    body.innerHTML = '';
    game.events.forEach((ev, i) => {
      const card = document.createElement('div'); card.className = 'bk-card bk-event';
      const w = ev.when;
      card.innerHTML = `
        <div class="bk-row bk-when">
          <span class="bk-kw">WHEN</span><button data-k="trigger" class="bk-trigger">${esc(triggerText(w))}</button>
          <span class="bk-sp"></span>
          <button data-k="up">↑</button><button data-k="down">↓</button><button data-k="del" class="bk-danger">✕</button>
        </div>
        <div class="bk-conds"></div>
        <div class="bk-row"><span class="bk-kw">DO</span></div>
        <div class="bk-actions"></div>`;
      // trigger params inline
      const whenRow = card.querySelector('.bk-when');
      const paramHost = document.createElement('span'); paramHost.className = 'bk-params';
      whenRow.insertBefore(paramHost, whenRow.querySelector('.bk-sp'));
      renderParams(paramHost, w, TRIGGERS[w.type].params);
      card.querySelector('[data-k="trigger"]').onclick = () => pickKeyed('When…', TRIGGERS, (t) => { ev.when = withDefaults({ type: t, id: Date.now() }, TRIGGERS[t].params); save(); render(); });
      card.querySelector('[data-k="up"]').onclick = () => { if (i > 0) { game.events.splice(i - 1, 0, game.events.splice(i, 1)[0]); save(); render(); } };
      card.querySelector('[data-k="down"]').onclick = () => { if (i < game.events.length - 1) { game.events.splice(i + 1, 0, game.events.splice(i, 1)[0]); save(); render(); } };
      card.querySelector('[data-k="del"]').onclick = () => confirmModal('Delete this event?', () => { game.events.splice(i, 1); save(); render(); });
      renderConds(card.querySelector('.bk-conds'), ev);
      renderActions(card.querySelector('.bk-actions'), ev.do = ev.do || []);
      body.appendChild(card);
    });
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ Add event';
    add.onclick = () => pickKeyed('When…', TRIGGERS, (t) => { game.events.push({ when: withDefaults({ type: t, id: Date.now() }, TRIGGERS[t].params), conds: [], do: [] }); save(); render(); });
    body.appendChild(add);
  }
  function triggerText(w) { const t = TRIGGERS[w.type]; return t ? t.label : w.type; }
  function withDefaults(o, params) { for (const [k, kind] of params) if (o[k] == null) o[k] = kind === 'sprite' ? (spriteIds()[0] || '') : kind === 'var' ? (varNames()[0] || 'score') : JSON.parse(JSON.stringify(DEFAULTS[kind] ?? DEFAULTS.value)); return o; }

  function renderConds(hostEl, owner) {
    hostEl.innerHTML = '';
    (owner.conds = owner.conds || []).forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'bk-row bk-cond';
      row.innerHTML = `<span class="bk-kw">${i === 0 ? 'AND' : 'AND'}</span><button data-k="type">${esc(CONDS[c.type].label)}</button><span class="bk-params"></span><span class="bk-sp"></span><button data-k="del" class="bk-danger">✕</button>`;
      renderParams(row.querySelector('.bk-params'), c, CONDS[c.type].params);
      row.querySelector('[data-k="type"]').onclick = () => pickKeyed('Condition', CONDS, (t) => { owner.conds[i] = withDefaults({ type: t }, CONDS[t].params); save(); render(); });
      row.querySelector('[data-k="del"]').onclick = () => { owner.conds.splice(i, 1); save(); render(); };
      hostEl.appendChild(row);
    });
    const add = document.createElement('button'); add.className = 'bk-mini'; add.textContent = '+ condition';
    add.onclick = () => pickKeyed('Condition', CONDS, (t) => { owner.conds.push(withDefaults({ type: t }, CONDS[t].params)); save(); render(); });
    hostEl.appendChild(add);
  }

  function renderActions(hostEl, list) {
    hostEl.innerHTML = '';
    list.forEach((a, i) => {
      const row = document.createElement('div'); row.className = 'bk-row bk-action';
      row.innerHTML = `<button data-k="type" class="bk-atype">${esc(ACTIONS[a.type] ? ACTIONS[a.type].label : a.type)}</button><span class="bk-params"></span><span class="bk-sp"></span><button data-k="up">↑</button><button data-k="down">↓</button><button data-k="del" class="bk-danger">✕</button>`;
      renderParams(row.querySelector('.bk-params'), a, ACTIONS[a.type] ? ACTIONS[a.type].params : []);
      row.querySelector('[data-k="type"]').onclick = () => pickKeyed('Action', ACTIONS, (t) => { const n = withDefaults({ type: t }, ACTIONS[t].params); if (t === 'if') { n.conds = []; n.then = []; } list[i] = n; save(); render(); });
      row.querySelector('[data-k="up"]').onclick = () => { if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); render(); } };
      row.querySelector('[data-k="down"]').onclick = () => { if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); save(); render(); } };
      row.querySelector('[data-k="del"]').onclick = () => { list.splice(i, 1); save(); render(); };
      hostEl.appendChild(row);
      if (a.type === 'if') {
        const nest = document.createElement('div'); nest.className = 'bk-nest';
        const c = document.createElement('div'); renderConds(c, a); nest.appendChild(c);
        const t = document.createElement('div'); t.innerHTML = '<div class="bk-row"><span class="bk-kw">THEN</span></div>'; const tl = document.createElement('div'); renderActions(tl, a.then = a.then || []); t.appendChild(tl); nest.appendChild(t);
        hostEl.appendChild(nest);
      }
    });
    const add = document.createElement('button'); add.className = 'bk-mini'; add.textContent = '+ action';
    add.onclick = () => pickKeyed('Action', ACTIONS, (t) => { const n = withDefaults({ type: t }, ACTIONS[t].params); if (t === 'if') { n.conds = []; n.then = []; } list.push(n); save(); render(); });
    hostEl.appendChild(add);
  }

  function renderParams(hostEl, obj, params) {
    hostEl.innerHTML = '';
    for (const [k, kind] of params) {
      const b = document.createElement('button'); b.className = 'bk-chip bk-' + kind;
      const v = obj[k];
      b.innerHTML = `<small>${esc(k)}</small> ${esc(kind === 'value' ? vfmt(v) : kind === 'media' ? String(v || '(pick)').replace(/^media\//, '') : String(v))}`;
      b.onclick = () => editParam(obj, k, kind, () => { save(); render(); });
      hostEl.appendChild(b);
    }
  }
  function editParam(obj, k, kind, done) {
    const set = (v) => { obj[k] = v; done(); };
    switch (kind) {
      case 'sprite': return pick('Sprite', spriteIds(), set);
      case 'button': return pick('Button', BUTTONS, set);
      case 'phase': return pick('When', ['pressed', 'held', 'released'], set);
      case 'target': return pick('Tap on', ['top', 'bottom', ...spriteIds()], set);
      case 'prop': return pick('Property', PROPS, set);
      case 'screen': return pick('Screen', ['top', 'bottom'], set);
      case 'shape': return pick('Shape', SHAPES, set);
      case 'op': return pick('Compare', OPS, set);
      case 'var': return pick('Variable', varNames().length ? varNames() : ['score'], set);
      case 'color': return pick('Color', COLORS, set, true);
      case 'name': return askText('Message name', obj[k] || '', (v) => set(v.trim() || 'ping'));
      case 'media': return mediaPicker(set);
      case 'value': return valuePicker(obj[k], set);
    }
  }

  // ---- variables
  function renderVars(body) {
    body.innerHTML = '';
    for (const name of varNames()) {
      const row = document.createElement('div'); row.className = 'bk-card bk-row';
      row.innerHTML = `<span class="bk-name">${esc(name)}</span><span class="bk-lbl">starts at</span>${stepper('v', +game.vars[name] || 0)}<span class="bk-sp"></span><button data-k="del" class="bk-danger">✕</button>`;
      wireStepper(row, (k, v) => { game.vars[name] = v; save(); });
      row.querySelector('[data-k="del"]').onclick = () => confirmModal('Delete variable ' + name + '?', () => { delete game.vars[name]; save(); render(); });
      body.appendChild(row);
    }
    const add = document.createElement('button'); add.className = 'bk-add'; add.textContent = '+ Add variable';
    add.onclick = () => askText('Variable name', '', (v) => { v = v.replace(/[^A-Za-z0-9_]/g, ''); if (v && !(v in game.vars)) { game.vars[v] = 0; save(); render(); } });
    body.appendChild(add);
  }

  // ---- settings
  function renderSettings(body) {
    body.innerHTML = `
      <div class="bk-card"><div class="bk-row"><span class="bk-lbl">Top screen background</span>${COLORS.concat(['#101418', '#1a1410']).map(c => `<button class="bk-color${c === game.background.top ? ' on' : ''}" data-s="top" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="bk-row"><span class="bk-lbl">Bottom screen background</span>${COLORS.concat(['#101418', '#1a1410']).map(c => `<button class="bk-color${c === game.background.bottom ? ' on' : ''}" data-s="bottom" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="bk-card bk-help">
        <b>How it works</b><br>
        Sprites live on the top (1920×1080) or bottom (1240×1080) screen; x,y is the sprite's centre.
        Events run every frame on the top screen: <i>WHEN</i> something happens <i>AND</i> all conditions are true, <i>DO</i> the actions in order.<br>
        <b>vx / vy</b> are speeds in pixels per second, so "Set vx = 300" keeps a sprite moving.<br>
        Controller: buttons A B X Y, L1 R1 L2 R2, D-pad, START, SELECT; sticks are available as values (left stick X/Y are −1…1).<br>
        Touch: "Tap on bottom" or "Tap on &lt;sprite&gt;" fire once per tap; "touch X / Y" values follow the finger.<br>
        Press <b>Run</b> to play on the other screen, <b>Dual</b> to play on both.
      </div>`;
    body.querySelectorAll('.bk-color').forEach(b => b.onclick = () => { game.background[b.dataset.s] = b.dataset.c; save(); render(); });
  }

  // ------------------------------------------------------------ widgets
  function chip(k, v) { return `<button data-k="${k}" class="bk-chip"><small>${k}</small> ${esc(v)}</button>`; }
  function stepper(k, v) {
    return `<span class="bk-step" data-step="${k}"><small>${k}</small><button data-d="-10">−10</button><button data-d="-1">−</button><button class="bk-num" data-d="0">${v}</button><button data-d="1">+</button><button data-d="10">+10</button></span>`;
  }
  function wireStepper(root, onChange) {
    root.querySelectorAll('.bk-step').forEach(st => {
      const k = st.dataset.step, num = st.querySelector('.bk-num');
      st.querySelectorAll('button').forEach(b => b.onclick = () => {
        const d = +b.dataset.d;
        if (d === 0) keypad(+num.textContent, (v) => { num.textContent = v; onChange(k, v); });
        else { const v = (+num.textContent || 0) + d; num.textContent = v; onChange(k, v); }
      });
    });
  }

  // modal helpers (use the editor's modal box)
  function showModal(html, wire) { $('modalBox').innerHTML = html; $('modal').classList.add('on'); wire && wire(); setTimeout(() => { const f = $('modalBox').querySelector('button, input'); f && f.focus(); }, 0); }
  function closeModal() { $('modal').classList.remove('on'); }
  api.closeModal = () => { if ($('modal').classList.contains('on')) { closeModal(); return true; } return false; };
  function pick(title, options, cb, isColor) {
    showModal(`<h3>${esc(title)}</h3><div class="list bk-picklist">${options.map(o => isColor ? `<button data-v="${esc(o)}" style="background:${esc(o)};height:40px"></button>` : `<button data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.v); });
      $('cl').onclick = closeModal;
    });
  }
  function pickKeyed(title, table, cb) {
    showModal(`<h3>${esc(title)}</h3><div class="list bk-picklist">${Object.keys(table).map(k => `<button data-v="${k}">${esc(table[k].label)}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); cb(b.dataset.v); });
      $('cl').onclick = closeModal;
    });
  }
  function confirmModal(msg, cb) {
    showModal(`<h3>${esc(msg)}</h3><div class="row"><button id="ok" style="color:var(--err)">Yes</button><button id="cl">Cancel</button></div>`, () => { $('cl').onclick = closeModal; $('ok').onclick = () => { closeModal(); cb(); }; });
  }
  function askText(title, value, cb) {
    showModal(`<h3>${esc(title)}</h3><input id="av"><div class="row"><button id="ok" class="acc">OK</button><button id="cl">Cancel</button></div>`, () => {
      const i = $('av'); i.value = value; i.focus(); i.select();
      $('cl').onclick = closeModal; $('ok').onclick = () => { const v = i.value; closeModal(); cb(v); };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ok').onclick(); });
    });
  }
  function keypad(start, cb) {
    let s = String(start ?? 0);
    showModal(`<h3>Number</h3><div class="bk-keypad"><div class="bk-kpv" id="kpv">${esc(s)}</div>${['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '0', '.'].map(k => `<button data-kp="${k}">${k}</button>`).join('')}<button data-kp="bs">⌫</button><button data-kp="clr">C</button><button data-kp="ok" class="acc">OK</button></div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      let fresh = true;
      $('modalBox').querySelectorAll('[data-kp]').forEach(b => b.onclick = () => {
        const k = b.dataset.kp;
        if (k === 'ok') { closeModal(); cb(+s || 0); return; }
        if (k === 'bs') s = s.slice(0, -1); else if (k === 'clr') s = ''; else if (k === '-') s = s.startsWith('-') ? s.slice(1) : '-' + s; else { if (fresh) s = ''; s += k; }
        fresh = false; $('kpv').textContent = s || '0';
      });
      $('cl').onclick = closeModal;
    });
  }
  function valuePicker(cur, cb) {
    const kinds = [
      ['Number', () => keypad(cur && 'n' in cur ? cur.n : 0, (n) => cb({ n }))],
      ['Variable', () => pick('Variable', varNames().length ? varNames() : ['score'], (v) => cb({ v }))],
      ['Sprite property', () => pick('Sprite', spriteIds(), (s) => pick('Property', PROPS, (p) => cb({ p: [s, p] })))],
      ['Random number', () => keypad(1, (a) => keypad(10, (b) => cb({ rnd: [a, b] })))],
      ['Left stick X (−1…1)', () => cb({ stick: 'lx' })], ['Left stick Y', () => cb({ stick: 'ly' })],
      ['Right stick X', () => cb({ stick: 'rx' })], ['Right stick Y', () => cb({ stick: 'ry' })],
      ['Touch X', () => cb({ touchx: 1 })], ['Touch Y', () => cb({ touchy: 1 })],
      ['Time since start (s)', () => cb({ time: 1 })],
      ['Text…', () => askText('Text', cur && 's' in cur ? cur.s : '', (s) => cb({ s }))],
      ['Math: a + b', () => mathPicker('+')], ['Math: a − b', () => mathPicker('-')], ['Math: a × b', () => mathPicker('*')], ['Math: a ÷ b', () => mathPicker('/')],
    ];
    function mathPicker(op) { valuePicker(null, (a) => valuePicker(null, (b) => cb({ op, a, b }))); }
    showModal(`<h3>Value <small class="muted">(now: ${esc(vfmt(cur))})</small></h3><div class="list bk-picklist">${kinds.map((k, i) => `<button data-i="${i}">${esc(k[0])}</button>`).join('')}</div><div class="row"><button id="cl">Cancel</button></div>`, () => {
      $('modalBox').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeModal(); kinds[+b.dataset.i][1](); });
      $('cl').onclick = closeModal;
    });
  }
})();
