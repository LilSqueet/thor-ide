/* Thor IDE — controller navigation for the editor itself.
 * D-pad / left stick moves a focus ring between controls, A activates, B goes back,
 * L1 / R1 switch tabs (Blocks panels or Code file tabs), START = Run, SELECT = Blocks/Code.
 * Input arrives from the native layer (MainActivity → window.ThorInput.button) or, in a browser,
 * from the Gamepad API / keyboard.
 */
(function () {
  'use strict';
  let lastStick = { lx: 0, ly: 0 }, stickCooldown = 0;

  function focusables() {
    const modal = document.getElementById('modal');
    const root = modal && modal.classList.contains('on') ? modal : document;
    return [...root.querySelectorAll('button, select, input, textarea, .tab, [tabindex]')].filter(el => {
      if (el.disabled || el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
  }
  function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; }
  function move(dir) {
    const all = focusables(); if (!all.length) return;
    let cur = document.activeElement;
    if (!cur || !all.includes(cur)) { setFocus(all[0]); return; }
    const c = center(cur);
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const e = center(el);
      const dx = e.x - c.x, dy = e.y - c.y;
      let primary, secondary;
      if (dir === 'UP') { primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'DOWN') { primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'LEFT') { primary = -dx; secondary = Math.abs(dy); }
      else { primary = dx; secondary = Math.abs(dy); }
      if (primary <= 4) continue;
      // Prefer elements roughly in line; penalize sideways distance heavily for vertical moves.
      const score = primary + secondary * (dir === 'UP' || dir === 'DOWN' ? 2.5 : 3.5);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }
  function setFocus(el) {
    document.querySelectorAll('.gp-focus').forEach(x => x.classList.remove('gp-focus'));
    el.classList.add('gp-focus');
    el.focus({ preventScroll: false });
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
  function activate() {
    const el = document.activeElement; if (!el) return;
    if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    el.click();
  }
  function back() {
    if (window.ThorBlocks && ThorBlocks.closeModal && ThorBlocks.closeModal()) return;
    const modal = document.getElementById('modal');
    if (modal && modal.classList.contains('on')) { modal.classList.remove('on'); return; }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) el.blur();
  }
  const inText = () => { const el = document.activeElement; return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'range')); };

  function onButton(name, down) {
    if (!down) return;
    const modalOpen = document.getElementById('modal').classList.contains('on');
    switch (name) {
      case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT':
        if (inText() && !modalOpen) { caret(name); return; }
        move(name); return;
      case 'A': activate(); return;
      case 'B': back(); return;
      case 'L1': if (!modalOpen) window.ThorNav && ThorNav.prevTab && ThorNav.prevTab(); return;
      case 'R1': if (!modalOpen) window.ThorNav && ThorNav.nextTab && ThorNav.nextTab(); return;
      case 'START': if (!modalOpen) window.ThorNav && ThorNav.run && ThorNav.run(); return;
      case 'SELECT': if (!modalOpen) window.ThorNav && ThorNav.toggleMode && ThorNav.toggleMode(); return;
      case 'Y': if (!modalOpen) window.ThorNav && ThorNav.keyboard && ThorNav.keyboard(); return;
    }
  }
  function caret(dir) {
    const t = document.activeElement; const v = t.value, s = t.selectionStart;
    if (dir === 'LEFT') t.selectionStart = t.selectionEnd = Math.max(0, s - 1);
    else if (dir === 'RIGHT') t.selectionStart = t.selectionEnd = Math.min(v.length, s + 1);
    else {
      const ls = v.lastIndexOf('\n', s - 1) + 1, col = s - ls;
      if (dir === 'UP') { if (ls === 0) return; const pls = v.lastIndexOf('\n', ls - 2) + 1; t.selectionStart = t.selectionEnd = Math.min(pls + col, ls - 1); }
      else { const ne = v.indexOf('\n', s); if (ne < 0) return; const nle = v.indexOf('\n', ne + 1); t.selectionStart = t.selectionEnd = Math.min(ne + 1 + col, nle < 0 ? v.length : nle); }
    }
  }

  // Public entry points (native layer / simulator)
  window.ThorInput = {
    button(name, down) { onButton(name, !!down); },
    axes(lx, ly) {
      // left stick acts as a repeating D-pad
      const now = performance.now();
      const dir = Math.abs(lx) > 0.6 ? (lx > 0 ? 'RIGHT' : 'LEFT') : Math.abs(ly) > 0.6 ? (ly > 0 ? 'DOWN' : 'UP') : null;
      if (dir && now > stickCooldown) { onButton(dir, true); stickCooldown = now + 220; }
      lastStick = { lx, ly };
    },
  };
  // Browser fallback: Gamepad API polling + keyboard (when not typing)
  const GP_MAP = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 8: 'SELECT', 9: 'START', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };
  const prev = {};
  setInterval(() => {
    if (!navigator.getGamepads) return;
    let gps; try { gps = navigator.getGamepads(); } catch (e) { return; }
    for (const gp of gps || []) {
      if (!gp) continue;
      gp.buttons.forEach((b, i) => { const n = GP_MAP[i]; if (!n) return; const d = b.pressed; if (d !== !!prev[n]) { prev[n] = d; onButton(n, d); } });
      window.ThorInput.axes(gp.axes[0] || 0, gp.axes[1] || 0);
    }
  }, 50);
  const KEY_MAP = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'A', Escape: 'B', PageUp: 'L1', PageDown: 'R1' };
  document.addEventListener('keydown', (e) => {
    if (inText() && e.key !== 'Escape') return;
    const n = KEY_MAP[e.key]; if (!n) return;
    const el = document.activeElement;
    if (n === 'A' && el && (el.tagName === 'BUTTON' || el.tagName === 'SELECT')) { if (el.tagName === 'BUTTON') return; /* native Enter click */ }
    e.preventDefault(); onButton(n, true);
  });
})();
