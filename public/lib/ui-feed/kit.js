// ui-feed/kit.js: the base class for the controls rebuilt from ui-feed.dev, and the drawing helpers they share.
//
// A control is a custom element. Its shadow root holds one drawable 2D canvas, and the canvas holds the
// native elements that do the work (an <input type="checkbox">, radios, an <input>, a <table>, a <slot>).
// The canvas draws the whole control: it draws pictures of those elements where it wants them, which also
// puts their hit regions there, and it draws the rest (a lamp, a ball, a display) itself.
//
//   class MySwitch extends FeedControl {
//     static size = [360, 280];                       // the design size. Drawing is in these units at any width
//     static html = '<input type="checkbox">';        // children of the canvas. Top-level ones get `drawable`
//     static radius = 14;                             // corner radius of the canvas, in CSS pixels
//     static fps = 0;                                 // limit a continuous animation to this many frames a second
//     static css = 'input { width: 120px; height: 60px; opacity: 0 }';   // applies inside the canvas only
//     ready() {}                                      // once, after the shadow tree is built
//     draw(ctx, w, h, time) { return false; }         // return true to be drawn again next frame
//   }
//
//   this.$(selector)       an element in the shadow tree
//   this.request()         ask for one paint
//   this.setValue(v)       the value the control submits with its form (ElementInternals.setFormValue)
//   this.dt                seconds since the last drawn frame, at most 1/30
//   this.px                device pixels per design unit
//   this.plain             true when the native elements are shown as plain HTML (no API, or a lost context)
//
// Data that the page author supplies goes in the light DOM: <option> children read by options(), or
// content for a <slot> that sits inside a drawable element of the canvas.

export const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
export const TAU = Math.PI * 2;
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const reduced = () => reduce.matches;

let missed = false;

// #region put
// drawElementImage() with a size, in design units. The element's hit region goes where it is drawn.
export function put(ctx, el, x = 0, y = 0, w = el.offsetWidth, h = el.offsetHeight) {
  try { ctx.drawElementImage(el, x, y, w, h); return true; } catch { missed = true; return false; }
}

// Put the hit region of an element somewhere without drawing it: a draw with no alpha still moves it.
export function hit(ctx, el, x = 0, y = 0, w = el.offsetWidth, h = el.offsetHeight) {
  ctx.save();
  ctx.globalAlpha = 0;
  put(ctx, el, x, y, w, h);
  ctx.restore();
}
// #endregion put

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// A damped spring, stepped in the paint handler. s = { x, v }.
export function spring(s, target, dt, k = 180, c = 18) {
  if (reduced()) { s.x = target; s.v = 0; return false; }
  const steps = 4, h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-k * (s.x - target) - c * s.v) * h;
    s.x += s.v * h;
  }
  if (Math.abs(s.x - target) < 0.0005 && Math.abs(s.v) < 0.005) { s.x = target; s.v = 0; return false; }
  return true;
}

// The <option> children of a control, as plain data. Authors configure a list this way.
export function options(host) {
  return [...host.querySelectorAll(':scope > option')].map((o, i) => ({
    value: o.getAttribute('value') ?? o.textContent.trim(),
    label: o.textContent.trim(),
    selected: o.hasAttribute('selected'),
    disabled: o.hasAttribute('disabled'),
    data: { ...o.dataset },
    index: i,
  }));
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// #region base
export class FeedControl extends HTMLElement {
  static formAssociated = true;
  static size = [360, 300];
  static html = '';
  static css = '';

  #built = false; #lost = false; #visible = false; #near = null;
  #rafId = 0; #timerId = 0; #lostTimer = 0; #retries = 0; #last = 0;
  #pw = 0; #ph = 0; #ro = null; #io = null; #nearIo = null;

  constructor() {
    super();
    this.internals = this.attachInternals?.() ?? null;
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.dt = 1 / 60;
    this.px = 1;
    this.plain = false;
  }

  $(sel) { return this.shadowRoot.querySelector(sel); }
  $$(sel) { return [...this.shadowRoot.querySelectorAll(sel)]; }
  setValue(v) { try { this.internals?.setFormValue(v); } catch {} }
  // Where a descendant sits inside `this.sheet`, in design units, so that a slice of the sheet's picture can
  // be drawn in place of the descendant. A slotted element has no picture of its own.
  // Where an element sits inside `host`, in design units. Measured with offsetTop and offsetLeft, never with
  // getBoundingClientRect(): the rectangle of an element the canvas has drawn reports where the draw put it,
  // in device pixels, so reading it and using it as the next draw's size multiplies the element each frame.
  slice(el, host = this.sheet) {
    // A slotted element's offsetParent is the host, not the <div> it is slotted into, so each one is measured
    // to the top of its own chain and the two are subtracted.
    const abs = (n) => { let top = 0, left = 0; for (; n; n = n.offsetParent) { top += n.offsetTop; left += n.offsetLeft; } return { top, left }; };
    const a = abs(el), b = abs(host);
    return { top: a.top - b.top, left: a.left - b.left, w: host.offsetWidth, h: host.offsetHeight, ew: el.offsetWidth, eh: el.offsetHeight };
  }
  request() {
    if (!this.#lost && !this.plain && this.#near !== false && this.canvas?.width && this.canvas?.height) {
      this.canvas.requestPaint?.();
    }
  }

  #cancelFrame() {
    if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = 0; }
    if (this.#timerId) { clearTimeout(this.#timerId); this.#timerId = 0; }
  }

  #syncSize() {
    const canvas = this.canvas;
    if (!canvas || this.plain || this.#lost) return;
    if (!this.#near) {
      this.#cancelFrame();
      if (canvas.width !== 0) canvas.width = 0;
      if (canvas.height !== 0) canvas.height = 0;
      evictScratch(this);
      return;
    }
    const w = this.#pw || Math.round(canvas.clientWidth * devicePixelRatio);
    const h = this.#ph || Math.round(canvas.clientHeight * devicePixelRatio);
    if (!w || !h) return;
    // Assigning width or height clears the canvas, so do it only when the size changed.
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    this.request();
  }

  #observe() {
    if (this.plain || !this.canvas) return;
    this.#ro?.observe(this.canvas, { box: 'device-pixel-content-box' });
    this.#io?.observe(this.canvas);
    this.#nearIo?.observe(this.canvas);
  }

  connectedCallback() {
    if (this.#built) {
      this.#observe();
      return;
    }
    this.#built = true;
    const C = this.constructor, [W, H] = C.size, root = this.shadowRoot;
    const base = `:host{display:block;position:relative;width:100%;max-width:${W}px;-webkit-tap-highlight-color:transparent}
      :host([hidden]){display:none}
      .note{margin:6px 0 0;font:13px/1.4 system-ui,sans-serif;opacity:.75}`;
    if (!SUPPORTED) return this.#plain(base, 'This browser has no HTML-in-canvas API. The control is shown as plain HTML.');
    // The component's own rules are nested under `canvas`, so the plain fallback shows unstyled native controls.
    root.innerHTML = `<style>${base}
      :host{aspect-ratio:${W}/${H}}
      canvas{display:block;width:100%;height:100%;border-radius:${C.radius ?? 14}px;touch-action:manipulation;
        > *{position:absolute;left:0;top:0;margin:0;box-sizing:border-box}
        ${C.css}}</style><canvas content="drawable" layoutsubtree>${C.html}</canvas>`;
    const canvas = this.canvas = root.querySelector('canvas');
    canvas.width = 0; canvas.height = 0;
    for (const el of canvas.children) el.setAttribute('drawable', '');
    const ctx = this.ctx = canvas.getContext('2d');
    this.ready?.();

    canvas.addEventListener('paint', () => {
      if (this.#lost || this.plain || !this.#near || !canvas.clientWidth || !canvas.width || !canvas.height) return;
      const now = performance.now();
      this.dt = clamp((now - this.#last) / 1000, 1 / 240, 1 / 30);
      this.#last = now;
      this.px = canvas.width / W;
      ctx.reset();
      ctx.scale(this.px, this.px);              // draw in design units from here on
      missed = false;
      let again = this.draw(ctx, W, H, now);
      // An element has no picture until the browser has painted it once. Try again next frame.
      if (missed && this.#retries++ < 60) again = true; else if (!missed) this.#retries = 0;
      if (again && this.#visible && this.#near && !this.#rafId && !this.#timerId) {
        const next = () => {
          this.#timerId = 0;
          this.#rafId = requestAnimationFrame(() => { this.#rafId = 0; this.request(); });
        };
        // A control whose picture only drifts (static fps) is drawn less often than the screen refreshes.
        if (C.fps) this.#timerId = setTimeout(next, 1000 / C.fps - 8); else next();
      }
    });
    this.#ro = new ResizeObserver((entries) => {
      const e = entries.at(-1);
      const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: Math.round(canvas.clientWidth * devicePixelRatio), blockSize: Math.round(canvas.clientHeight * devicePixelRatio) };
      if (!box.inlineSize || !box.blockSize) return;
      this.#pw = box.inlineSize;
      this.#ph = box.blockSize;
      if (this.#near === null) {
        const r = canvas.getBoundingClientRect();
        this.#near = r.top < innerHeight * 2 && r.bottom > -innerHeight;
      }
      this.#syncSize();
    });
    this.#io = new IntersectionObserver((entries) => {
      this.#visible = entries.at(-1).isIntersecting;
      if (this.#visible) this.request();
      else this.#cancelFrame();
    }, { rootMargin: '80px 0px' });
    // Far from the viewport, shrink the backing store and any dotBoard scratch canvases to 0 x 0.
    this.#nearIo = new IntersectionObserver((entries) => {
      const near = entries.at(-1).isIntersecting;
      if (near === this.#near) return;
      this.#near = near;
      this.#syncSize();
    }, { rootMargin: '100% 0px' });
    this.#observe();
    // State that changes no pixel of an element's picture raises no paint event, so ask after each of these.
    for (const type of ['input', 'change', 'focusin', 'focusout', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'slotchange']) {
      root.addEventListener(type, () => this.request());
    }
    // A lost context leaves live, invisible controls in an empty box. Wait for the browser to restore it
    // (shared/context-guard.js asks for a paint then). If it stays lost, show the controls as plain HTML.
    canvas.addEventListener('contextlost', () => {
      this.#lost = true;
      this.#cancelFrame();
      if (this.#lostTimer) clearTimeout(this.#lostTimer);
      this.#lostTimer = setTimeout(() => {
        this.#lostTimer = 0;
        if (this.#lost) this.#plain(base, 'The canvas lost its drawing context. The control is shown as plain HTML.');
      }, 1500);
    });
    canvas.addEventListener('contextrestored', () => {
      if (this.#lostTimer) { clearTimeout(this.#lostTimer); this.#lostTimer = 0; }
      this.#lost = false;
      invalidateScratchPatterns(this);
      this.#syncSize();
    });
  }

  disconnectedCallback() {
    this.#cancelFrame();
    if (this.#lostTimer) { clearTimeout(this.#lostTimer); this.#lostTimer = 0; }
    this.#ro?.disconnect();
    this.#io?.disconnect();
    this.#nearIo?.disconnect();
    this.#visible = false;
    this.#near = null;
    this.#pw = 0;
    this.#ph = 0;
    if (this.canvas) window.__gfx?.retire(this.canvas);
    retireScratch(this);
  }

  #plain(base, note) {
    if (this.plain) return;
    this.plain = true;
    this.#cancelFrame();
    if (this.#lostTimer) { clearTimeout(this.#lostTimer); this.#lostTimer = 0; }
    this.#ro?.disconnect();
    this.#io?.disconnect();
    this.#nearIo?.disconnect();
    this.#visible = false;
    this.#near = false;
    retireScratch(this);
    const root = this.shadowRoot, old = this.canvas;
    const box = document.createElement('div');
    box.className = 'plain';
    if (old) { box.append(...old.childNodes); window.__gfx?.retire(old); }
    else { box.innerHTML = this.constructor.html; }
    root.innerHTML = `<style>${base} .plain{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px;border:1px solid #8886;border-radius:10px;font:15px/1.4 system-ui,sans-serif}</style>`;
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = note;
    root.append(box, p);
    if (!old) this.ready?.();
    this.dispatchEvent(new CustomEvent('feed-plain'));
  }
}
// #endregion base

// #region dots
// Show part of the canvas as a board of dots, with no readback.
//
//   dotBoard(control, ctx, { x, y, w, h, cell, bg, off, shape, glow, id }, (ctx) => { put(ctx, element, 0, 0); });
// `id` names the board when a control has more than one. `compose: false` returns the enlarged picture
// (out.big, a plain canvas) for the caller to draw.
//
// 1. The callback draws elements with the origin at the board's corner. The transform is set so that one
//    `cell` of the design becomes one device pixel, so the picture arrives already reduced to one pixel a dot.
// 2. That small picture is copied to a plain canvas with drawImage() (allowed from a drawable canvas).
// 3. It is drawn back enlarged with smoothing off, through a mask that has one disc (or square) per cell.
// The colours are the element's own, so :checked, :disabled and ::selection styles show on the board.
const scratch = new WeakMap();
const mkCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = 1; return c; };
function scratchOf(control, id) {
  let m = scratch.get(control);
  if (!m) scratch.set(control, m = new Map());
  let s = m.get(id);
  if (!s) {
    m.set(id, s = { low: mkCanvas(), big: mkCanvas(), dot: mkCanvas(), glow: null, key: '', bigPat: null, ctxPat: null, ctxFor: null });
  }
  return s;
}
function evictScratch(control) {
  const m = scratch.get(control);
  if (!m) return;
  for (const s of m.values()) {
    for (const c of [s.low, s.big, s.glow]) {
      if (c && (c.width || c.height)) { c.width = 0; c.height = 0; }
    }
  }
}
function invalidateScratchPatterns(control) {
  const m = scratch.get(control);
  if (!m) return;
  for (const s of m.values()) { s.bigPat = null; s.ctxPat = null; s.ctxFor = null; }
}
function retireScratch(control) {
  const m = scratch.get(control);
  if (!m) return;
  for (const s of m.values()) {
    for (const c of [s.low, s.big, s.dot, s.glow]) {
      if (!c) continue;
      if (c.width || c.height) { c.width = 0; c.height = 0; }
      window.__gfx?.retire(c);
    }
    s.key = ''; s.bigPat = null; s.ctxPat = null; s.ctxFor = null;
  }
}

export function dotBoard(control, ctx, o, drawSource) {
  const { x, y, w, h, cell = 4, bg = '#0b0b0b', off = 0.07, shape = 'round', glow = 0, fill = 0.82, id = 0, compose = true } = o;
  const px = control.px, s = scratchOf(control, id);
  const cp = Math.max(2, Math.round(cell * px));          // device pixels per dot
  const X = Math.round(x * px), Y = Math.round(y * px);
  const cols = Math.max(1, Math.floor((w * px) / cp)), rows = Math.max(1, Math.floor((h * px) / cp));
  const BW = cols * cp, BH = rows * cp;

  // 1. the elements, one device pixel for each dot
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.rect(X, Y, cols, rows); ctx.clip();
  ctx.clearRect(X, Y, cols, rows);
  ctx.setTransform(px / cp, 0, 0, px / cp, X, Y);       // one design unit is px/cp of a dot
  drawSource(ctx, (cols * cp) / px, (rows * cp) / px);
  ctx.restore();

  // 2. copy the small picture out
  if (s.low.width !== cols || s.low.height !== rows) { s.low.width = cols; s.low.height = rows; }
  const lc = s.low.getContext('2d');
  lc.clearRect(0, 0, cols, rows);
  lc.drawImage(control.canvas, X, Y, cols, rows, 0, 0, cols, rows);

  // the mask: one cell of it
  const key = `${cp}|${shape}|${fill}`;
  if (s.key !== key) {
    s.key = key;
    s.dot.width = s.dot.height = cp;
    const dc = s.dot.getContext('2d');
    dc.clearRect(0, 0, cp, cp);
    dc.fillStyle = '#fff';
    if (shape === 'square') dc.fillRect(0, 0, Math.max(1, Math.round(cp * fill)), Math.max(1, Math.round(cp * fill)));
    else { dc.beginPath(); dc.arc(cp / 2, cp / 2, (cp * fill) / 2, 0, TAU); dc.fill(); }
    s.bigPat = null;
    s.ctxPat = null;
  }

  // 3. enlarge with smoothing off, then keep only what is under the mask
  if (s.big.width !== BW || s.big.height !== BH) { s.big.width = BW; s.big.height = BH; }
  const bc = s.big.getContext('2d');
  bc.globalCompositeOperation = 'source-over';
  bc.clearRect(0, 0, BW, BH);
  bc.imageSmoothingEnabled = false;
  bc.drawImage(s.low, 0, 0, cols, rows, 0, 0, BW, BH);
  bc.globalCompositeOperation = 'destination-in';
  if (!s.bigPat) s.bigPat = bc.createPattern(s.dot, 'repeat');
  bc.fillStyle = s.bigPat;
  bc.fillRect(0, 0, BW, BH);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(X, Y, cols, rows);
  const out = { cols, rows, cell: cp / px, big: s.big, w: BW / px, h: BH / px, ox: (X + Math.floor((w * px - BW) / 2)) / px, oy: (Y + Math.floor((h * px - BH) / 2)) / px };
  if (!compose) { ctx.restore(); return out; }          // the caller draws out.big itself
  ctx.fillStyle = bg;
  ctx.fillRect(Math.round(x * px), Math.round(y * px), Math.round(w * px), Math.round(h * px));
  const ox = X + Math.floor((w * px - BW) / 2), oy = Y + Math.floor((h * px - BH) / 2);
  if (off) {                                              // the unlit dots
    if (!s.ctxPat || s.ctxFor !== ctx) { s.ctxPat = ctx.createPattern(s.dot, 'repeat'); s.ctxFor = ctx; }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalAlpha = off;
    ctx.fillStyle = s.ctxPat;
    ctx.fillRect(0, 0, BW, BH);
    ctx.restore();
  }
  if (glow) {
    // Blur at dot resolution (s.low) instead of full DPR (s.big), then composite scaled up.
    const target = Math.max(1, glow * px) / cp;
    const r = target > 0.5 ? Math.sqrt(target * target - 0.16) : target * 0.6;
    const pad = Math.max(1, Math.ceil(r * 3));
    const gw = cols + pad * 2, gh = rows + pad * 2;
    if (!s.glow) s.glow = mkCanvas();
    if (s.glow.width !== gw || s.glow.height !== gh) { s.glow.width = gw; s.glow.height = gh; }
    const gc = s.glow.getContext('2d');
    gc.clearRect(0, 0, gw, gh);
    gc.filter = `blur(${r.toFixed(2)}px)`;
    gc.drawImage(s.low, pad, pad);
    gc.filter = 'none';
    const area = shape === 'square' ? fill * fill : (Math.PI / 4) * fill * fill;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * area;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.glow, 0, 0, gw, gh, ox - pad * cp, oy - pad * cp, gw * cp, gh * cp);
    ctx.restore();
  }
  ctx.drawImage(s.big, ox, oy);
  ctx.restore();
  return out;
}
// #endregion dots

// A seven-segment digit, for the LCD controls. on/off are colours.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '', F: 'aefg', O: 'abcdef', N: 'abcef', L: 'def', o: 'cdeg', n: 'ceg' };
export function seg7(ctx, ch, x, y, w, h, on, off) {
  const t = w * 0.17, g = t * 0.18, hh = h / 2;
  const hbar = (cx, cy) => { ctx.beginPath(); ctx.moveTo(cx + t / 2 + g, cy); ctx.lineTo(cx + t + g, cy - t / 2); ctx.lineTo(cx + w - t - g, cy - t / 2); ctx.lineTo(cx + w - t / 2 - g, cy); ctx.lineTo(cx + w - t - g, cy + t / 2); ctx.lineTo(cx + t + g, cy + t / 2); ctx.closePath(); ctx.fill(); };
  const vbar = (cx, cy, len) => { ctx.beginPath(); ctx.moveTo(cx, cy + t / 2 + g); ctx.lineTo(cx + t / 2, cy + t + g); ctx.lineTo(cx + t / 2, cy + len - t - g); ctx.lineTo(cx, cy + len - t / 2 - g); ctx.lineTo(cx - t / 2, cy + len - t - g); ctx.lineTo(cx - t / 2, cy + t + g); ctx.closePath(); ctx.fill(); };
  const lit = SEG[ch] ?? '';
  const seg = (name, fn) => { ctx.fillStyle = lit.includes(name) ? on : off; if (lit.includes(name) || off) fn(); };
  ctx.save();
  ctx.transform(1, 0, -0.06, 1, h * 0.06, 0);
  seg('a', () => hbar(x, y + t / 2));
  seg('g', () => hbar(x, y + hh));
  seg('d', () => hbar(x, y + h - t / 2));
  seg('f', () => vbar(x + t / 2, y, hh));
  seg('b', () => vbar(x + w - t / 2, y, hh));
  seg('e', () => vbar(x + t / 2, y + hh, hh));
  seg('c', () => vbar(x + w - t / 2, y + hh, hh));
  ctx.restore();
}
export function seg7Text(ctx, text, x, y, w, h, on, off, gap = w * 0.22) {
  for (const ch of String(text)) {
    if (ch === '.' ) { ctx.fillStyle = on; ctx.fillRect(x - gap * 0.75, y + h - w * 0.17, w * 0.17, w * 0.17); continue; }
    if (ch === ':') { ctx.fillStyle = on; const d = w * 0.17; ctx.fillRect(x, y + h * 0.28, d, d); ctx.fillRect(x, y + h * 0.66, d, d); x += d + gap; continue; }
    seg7(ctx, ch, x, y, w, h, on, off);
    x += w + gap;
  }
  return x;
}
