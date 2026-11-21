// Moving pieces of HTML in one 2D canvas, pressed by more than one pointer at a time.
//
//   import { createPieces, orbit } from '/motion-capture/pieces.js';
//   const pieces = createPieces(canvas, { labels: ['A', 'B', 'C'], where: orbit, onrecord: (r) => … });
//   pieces.build('one');     // every pad in one drawable element: one hit box for all of them
//   pieces.build('each');    // one drawable element for each pad: one hit box each
//   pieces.build('route');   // one drawable element, and the canvas sends each pointer on itself
//   pieces.start();          // move and paint; pieces.stop() ends the loop
//
// The page needs CSS for .padwrap, .piece and .pad (see index.html, region "css-pads").
// A pad is a <button> that counts its own pointerdown events. The canvas works out which pad is under
// a pointer from its own matrices (padAt) and compares that with the pad whose listener ran.

export const MODES = ['one', 'each', 'route'];
export const COLORS = ['#ffd166', '#06d6a0', '#4cc9f0', '#f78c6b', '#c8b6ff', '#ff70a6', '#b9fbc0', '#ffe66d'];
const MAX_SCALE = 2;

/** Where pad i is at time t: five pads on an outer ellipse, the rest on an inner one that turns the other way. */
export function orbit(i, t, W, H, n) {
  const outer = Math.min(5, n), inner = n - outer;
  const out = i < outer;
  const k = out ? i / outer : (i - outer) / Math.max(1, inner);
  const a = (out ? 1 : -1.6) * t * 0.22 + k * Math.PI * 2;
  const rx = out ? W / 2 - 54 : Math.min(54, W * 0.15), ry = out ? H / 2 - 44 : H * 0.15;
  return { x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry, angle: 0.4 * Math.sin(t * 0.8 + i * 1.7), scale: 1 + 0.1 * Math.sin(t * 1.3 + i) };
}

export function createPieces(canvas, { labels = 'ABCDEFGH'.split(''), where = orbit, onrecord = null } = {}) {
  const ctx = canvas.getContext('2d');
  const n = labels.length;
  const state = {
    mode: 'one', t: 0, paused: false, running: false,
    pads: [], sources: [], wrap: null, m: [], w: 80, h: 56,
    focus: 0, flip: false,
    counts: labels.map(() => 0),
    down: new Set(),          // pointers that are down on the canvas
    held: new Map(),          // pointerId -> index of the pad whose listener took it
    routes: new Map(),        // pointerId -> element the canvas sent it to (mode "route")
    open: new Map(),          // pointerId -> the record of its press
    marks: [], ripples: [],
    records: [],
    stats: { presses: 0, right: 0, second: 0, secondRight: 0 },
  };
  const synthetic = new WeakSet();
  const padOf = (node) => { const b = node?.closest?.('.pad'); return b && canvas.contains(b) ? Number(b.dataset.i) : -1; };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // #region build
  function build(mode) {
    state.mode = mode;
    for (const i of new Set(state.held.values())) state.pads[i]?.classList.remove('down');
    state.held.clear(); state.routes.clear(); state.down.clear(); state.open.clear();
    state.records.length = 0;
    Object.assign(state.stats, { presses: 0, right: 0, second: 0, secondRight: 0 });
    const pads = labels.map((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad';
      b.dataset.i = i;
      b.style.setProperty('--c', COLORS[i % COLORS.length]);
      b.innerHTML = `<b></b><span></span>`;
      b.firstChild.textContent = label;
      b.lastChild.textContent = state.counts[i];
      // The pad's own listener. Which pad runs this for a press is the thing being measured.
      b.addEventListener('pointerdown', (e) => press(i, e));
      return b;
    });
    if (mode === 'each') {
      // One drawable element for each pad. Each has its own hit box.
      state.wrap = null;
      state.sources = pads.map((b) => { const piece = document.createElement('div'); piece.className = 'piece'; piece.setAttribute('drawable', ''); piece.append(b); return piece; });
      canvas.replaceChildren(...state.sources);
    } else {
      // One drawable element holds every pad. The canvas draws a part of it for each pad. It has one hit box.
      state.wrap = document.createElement('div');
      state.wrap.className = 'padwrap';
      state.wrap.setAttribute('drawable', '');
      state.wrap.append(...pads);
      state.sources = [];
      canvas.replaceChildren(state.wrap);
    }
    state.pads = pads;
    canvas.requestPaint?.();
  }
  // #endregion build

  function press(i, e) {
    state.held.set(e.pointerId, i);
    state.counts[i]++;
    state.pads[i].lastChild.textContent = state.counts[i];
    state.pads[i].classList.add('down');
    state.ripples.push({ i, at: performance.now() });
    const rec = state.open.get(e.pointerId);
    if (rec) rec.reached = i;
  }
  function release(pointerId) {
    const i = state.held.get(pointerId);
    if (i === undefined) return;
    state.held.delete(pointerId);
    if (![...state.held.values()].includes(i)) state.pads[i]?.classList.remove('down');
  }

  // #region matrix
  /** The matrix that takes a pad's own box, centred on 0,0, to where it is drawn, in CSS pixels of the canvas. */
  function matrices() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    return state.pads.map((_, i) => {
      const p = where(i, state.t, W, H, n);
      return new DOMMatrix().translate(p.x, p.y).rotate((p.angle * 180) / Math.PI).scale(p.scale);
    });
  }
  /** Which pad is drawn at this point of the canvas. The last one drawn is on top. */
  function padAt(x, y) {
    for (let i = state.m.length - 1; i >= 0; i--) {
      const q = state.m[i].inverse().transformPoint(new DOMPoint(x, y));
      if (Math.abs(q.x) <= state.w / 2 && Math.abs(q.y) <= state.h / 2) return i;
    }
    return -1;
  }
  // #endregion matrix

  // #region hitbox
  /** Modes "one" and "route": put the element's one hit box where pad i is drawn. */
  function putBox(i, clearCache = true) {
    const pad = state.pads[i], m = state.m[i];
    if (!pad || !m || !state.wrap) return;
    canvas.updateElementGeometry(state.wrap, { canvasTransform: m.translate(-pad.offsetLeft - state.w / 2, -pad.offsetTop - state.h / 2) });
    // Chromium remembers the answer of a hit test for a point. Changing any attribute makes it ask again.
    if (clearCache) state.wrap.toggleAttribute('data-hit', (state.flip = !state.flip));
  }
  // #endregion hitbox

  // #region draw
  canvas.addEventListener('paint', () => {
    const dpr = canvas.width / canvas.clientWidth || 1, now = performance.now();
    if (state.pads[0]?.offsetWidth) { state.w = state.pads[0].offsetWidth; state.h = state.pads[0].offsetHeight; }
    const { w, h } = state;
    state.m = matrices();
    ctx.reset();
    const scale = new DOMMatrix().scale(dpr);
    // A ring grows from each pad that was pressed.
    state.ripples = state.ripples.filter((r) => now - r.at < 700);
    for (const r of state.ripples) {
      const k = (now - r.at) / 700;
      ctx.setTransform(scale.multiply(state.m[r.i]));
      ctx.strokeStyle = COLORS[r.i % COLORS.length];
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.roundRect(-w / 2 - 40 * k, -h / 2 - 40 * k, w + 80 * k, h + 80 * k, 12 + 40 * k);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    state.pads.forEach((pad, i) => {
      ctx.setTransform(scale.multiply(state.m[i]));
      if (state.mode === 'each') {
        ctx.drawElementImage(state.sources[i], -w / 2, -h / 2, w, h);
        canvas.updateElementGeometry(state.sources[i], { canvasTransform: state.m[i].translate(-w / 2, -h / 2) });
      } else {
        // Nine arguments: the pad's rectangle inside the one element, drawn centred on 0,0.
        ctx.drawElementImage(state.wrap, pad.offsetLeft, pad.offsetTop, w, h, -w / 2, -h / 2, w, h);
      }
    });
    if (state.mode !== 'each') {
      // After a nine-argument draw only that source rectangle of the element takes hits. A last draw of the
      // whole element at alpha 0 shows nothing and makes all of it take hits again, wherever the box is put.
      if (state.wholeDraw !== false) {
        const pad = state.pads[state.focus];
        ctx.setTransform(scale.multiply(state.m[state.focus].translate(-pad.offsetLeft - w / 2, -pad.offsetTop - h / 2)));
        ctx.globalAlpha = 0;
        ctx.drawElementImage(state.wrap, 0, 0, state.wrap.offsetWidth, state.wrap.offsetHeight);
        ctx.globalAlpha = 1;
      }
      putBox(state.focus, state.running && !state.paused);
    }
    // A ring at each pointer: green when the pad under it ran its listener, red when not.
    ctx.setTransform(scale);
    state.marks = state.marks.filter((k) => !k.until || now < k.until);
    for (const k of state.marks) {
      ctx.strokeStyle = k.rec.truth >= 0 && k.rec.reached === k.rec.truth ? '#2dd36f' : '#ff4d4d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(k.rec.x, k.rec.y, 26, 0, Math.PI * 2); ctx.stroke();
    }
  });
  // #endregion draw

  // #region route
  function send(target, type, e) {
    const copy = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons });
    synthetic.add(copy);
    target.dispatchEvent(copy);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (synthetic.has(e)) return;
    const p = local(e), truth = padAt(p.x, p.y);
    const rec = { pointerId: e.pointerId, type: e.pointerType, mode: state.mode, x: p.x, y: p.y, truth, said: padOf(e.target), reached: -1, second: state.down.size > 0, click: null };
    state.down.add(e.pointerId);
    state.open.set(e.pointerId, rec);
    state.marks.push({ rec, until: 0 });
    if (state.mode === 'one' && truth >= 0) { state.focus = truth; putBox(truth); }
    if (state.mode === 'route') {
      // The browser has already chosen a target with the hit box where it was. Do not let that press through.
      // Put the box under this pointer, ask the browser what is there now, and send that element a copy.
      e.stopPropagation();
      if (truth >= 0) {
        state.focus = truth;
        putBox(truth);
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== canvas && canvas.contains(el)) { state.routes.set(e.pointerId, el); send(el, 'pointerdown', e); }
      }
    }
    // In mode "route" the copy was dispatched synchronously, so the pad's listener has already run.
    if (state.mode === 'route') done(rec);
    canvas.requestPaint?.();
  }, true);
  // #endregion route

  function done(rec) {
    if (rec.counted) return;
    rec.counted = true;
    const s = state.stats, ok = rec.truth >= 0 && rec.reached === rec.truth;
    if (rec.truth >= 0) { s.presses++; if (ok) s.right++; if (rec.second) { s.second++; if (ok) s.secondRight++; } }
    state.records.push(rec);
    if (state.records.length > 40) state.records.shift();
    onrecord?.(rec, state);
  }
  // In modes "one" and "each" the pad's listener runs after the capture listener above and before this one.
  canvas.addEventListener('pointerdown', (e) => { if (!synthetic.has(e)) { const rec = state.open.get(e.pointerId); if (rec) done(rec); } });

  const up = (e) => {
    if (synthetic.has(e)) return;
    state.down.delete(e.pointerId);
    const rec = state.open.get(e.pointerId);
    const mark = state.marks.find((k) => k.rec === rec);
    if (mark) mark.until = performance.now() + 900;
    if (state.mode === 'route') {
      e.stopPropagation();
      const el = state.routes.get(e.pointerId);
      if (el) send(el, e.type, e);
      state.routes.delete(e.pointerId);
    }
    release(e.pointerId);
    canvas.requestPaint?.();
  };
  canvas.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', up, true);
  // A mouse moves before it presses, so one hit box can be put under it in time. A finger does not.
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'one' || e.pointerType !== 'mouse' || e.buttons) return;
    const p = local(e), i = padAt(p.x, p.y);
    if (i >= 0 && i !== state.focus) { state.focus = i; putBox(i); }
  }, true);
  canvas.addEventListener('click', (e) => { const rec = state.open.get(e.pointerId); if (rec) { rec.click = padOf(e.target); onrecord?.(rec, state); } }, true);

  /** The centre of pad i in client coordinates. */
  function centre(i) {
    const r = canvas.getBoundingClientRect(), c = state.m[i].transformPoint(new DOMPoint(0, 0));
    return { x: r.left + c.x, y: r.top + c.y };
  }

  // #region probe
  /**
   * Ask the browser what is at the centres of pads a and b, in one task. This is the same hit test that
   * decides where two pointers go. Returns the pad index the browser answered for each (-1 for none).
   */
  function probe(a, b) {
    state.m = matrices();
    const ask = (i) => { const c = centre(i); return padOf(document.elementFromPoint(c.x, c.y)); };
    if (state.mode === 'each') {
      state.sources.forEach((piece, i) => canvas.updateElementGeometry(piece, { canvasTransform: state.m[i].translate(-state.w / 2, -state.h / 2) }));
      return [ask(a), ask(b)];
    }
    if (state.mode === 'one') { state.focus = a; putBox(a); return [ask(a), ask(b)]; }
    state.focus = a; putBox(a);
    const first = ask(a);
    state.focus = b; putBox(b);
    return [first, ask(b)];
  }
  // #endregion probe

  function fit() {
    const dpr = Math.min(MAX_SCALE, devicePixelRatio * (canvas.currentCSSZoom || 1));
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.requestPaint?.();
  }
  new ResizeObserver(fit).observe(canvas);
  fit();

  let raf = 0, last = 0;
  const tick = (now) => {
    if (!state.running) return;
    if (!state.paused) state.t += Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    canvas.requestPaint?.();
    raf = requestAnimationFrame(tick);
  };

  return {
    state, build, padAt, putBox, centre, probe,
    labels,
    start() { if (state.running) return; state.running = true; last = 0; raf = requestAnimationFrame(tick); },
    stop() { state.running = false; cancelAnimationFrame(raf); },
    /** One paint, then resolve. */
    painted() { return new Promise((resolve) => { canvas.addEventListener('paint', () => resolve(), { once: true }); canvas.requestPaint(); }); },
  };
}
