// canvas-skin.js: <canvas-skin> wraps one element in a small canvas that draws it in the current skin.
//
//   <script type="module" src="/lib/canvas-skin.js"></script>
//   <main skin="gel">
//     <canvas-skin><button>Save</button></canvas-skin>
//     <canvas-skin><input type="range"></canvas-skin>
//   </main>
//
// The wrapped element stays in the page's own DOM: it keeps its listeners, its form, its focus and its
// name in the accessibility tree. The wrapper's shadow root holds a drawable 2D canvas, and inside the
// canvas one `drawable` <div> with a <slot>. The canvas is 14 px larger than the element on every side,
// so a skin can draw a shadow, a glow or a line that overshoots the box. The wrapper itself takes the
// same room in the layout as the element.
//
//   skin="name"                    on any ancestor (or on the wrapper): the skin to draw in
//   CanvasSkin.apply(root, name, { x, y })
//                                  sets root's skin. The wrappers under it change one after another,
//                                  ordered by distance from the client point x, y, and each one fades
//                                  from a copy of its old drawing to the new one
//   CanvasSkin.wrap(root, selector?)   wraps every matching element under root that is not wrapped yet
//   CanvasSkin.define(name, skin)  registers a skin (see canvas-skin-themes.js for the six built in)
//   kind="button | field | check | radio | switch | range | bar | media | text | card"
//                                  what the skin should draw. Chosen from the element when absent
//   inline / block                 layout of the wrapper. Chosen from the kind when absent
//   element.plain                  true when the element is shown as plain HTML (no API, or a lost context)
//
// For the kinds check, radio, switch, range and bar a skin draws the whole control from its state
// (checked, value). The native control is not painted, but it is still the thing that is tapped,
// dragged, focused and read out.
//
// One 2D context per wrapper and no WebGL: an element can only be drawn by a canvas it is inside, so
// wrappers cannot share a WebGL context, and Android allows about 8 of those in a tab. A wrapper that
// is far from the screen sets its canvas to 0 by 0.

import * as themes from './canvas-skin-themes.js';

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

const BLEED = 14;
const ENTER_MS = 640;
const CONTROL = new Set(['check', 'radio', 'switch', 'range', 'bar']);
const INLINE = new Set(['button', 'check', 'radio', 'switch']);
const INLINE_TEXT = /^(label|span|a|output)$/;   // text that is not a block of its own
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

// #region kind
// What a skin is asked to draw for an element.
function kindOf(el) {
  const tag = el.localName, type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'button' || (tag === 'input' && /^(button|submit|reset)$/.test(type)) || el.getAttribute('role') === 'button') return 'button';
  if (tag === 'input') {
    if (type === 'checkbox') return el.getAttribute('role') === 'switch' ? 'switch' : 'check';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'range';
    return 'field';
  }
  if (tag === 'select' || tag === 'textarea') return 'field';
  if (tag === 'progress' || tag === 'meter') return 'bar';
  if (/^(img|picture|video|svg|canvas)$/.test(tag)) return 'media';
  if (/^(h[1-6]|p|label|span|a|output|li|blockquote|legend)$/.test(tag)) return 'text';
  return 'card';
}
// #endregion kind

// #region page-css
// One stylesheet in the document. The first part gives every kind the same box in every skin, so a
// change of skin does not move the page. The second part removes the browser's own drawing of a
// control in every skin except "native". Each skin adds its colours and font below that.
const BASE_CSS = `
canvas-skin > * { margin: 0 !important; box-sizing: border-box; }
canvas-skin[kind="button"] > * { min-height: 44px; padding: 0 22px; font: inherit; font-weight: 600; cursor: pointer; touch-action: manipulation; }
canvas-skin[kind="field"] > * { display: block; width: 100%; min-height: 44px; padding: 10px 14px; font: inherit; font-size: max(16px, 1em); }
canvas-skin[kind="check"] > *, canvas-skin[kind="radio"] > * { display: block; width: 28px; height: 28px; cursor: pointer; }
canvas-skin[kind="switch"] > * { display: block; width: 50px; height: 28px; cursor: pointer; }
canvas-skin[kind="range"] > * { display: block; width: 100%; height: 28px; cursor: pointer; touch-action: pan-y; }
canvas-skin[kind="bar"] > * { display: block; width: 100%; height: 16px; }
canvas-skin[kind="media"] > * { display: block; max-width: 100%; height: auto; }
canvas-skin[kind="card"] > * { display: block; padding: 14px 16px; }
canvas-skin[kind="card"] > table { display: table; width: 100%; border-collapse: separate; border-spacing: 0; }
canvas-skin:not([now="native"], [plain]):is([kind="button"], [kind="field"], [kind="check"], [kind="radio"], [kind="switch"], [kind="range"], [kind="bar"], [kind="card"]) > * {
  appearance: none; -webkit-appearance: none; background: none; border: 0; border-radius: 0; box-shadow: none; outline: none; color: inherit; font-family: inherit;
}
canvas-skin[plain]:not([now="native"]):is([kind="button"], [kind="field"], [kind="card"]) > * {
  background: color-mix(in srgb, currentColor 10%, transparent); border: 1px solid currentColor; border-radius: 8px; color: inherit; font-family: inherit;
}
canvas-skin:not([now="native"], [plain])[kind="range"] > ::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; }
canvas-skin:not([now="native"]) :is(th, td) { padding: 8px 10px; text-align: left; border-bottom: 1px solid color-mix(in srgb, currentColor 24%, transparent); }
canvas-skin:not([now="native"]) tr:last-child > td { border-bottom: 0; }
canvas-skin:not([now="native"]) summary { cursor: pointer; font-weight: 600; min-height: 28px; }
canvas-skin:not([now="native"]) :is(button, input, select, textarea):disabled { cursor: default; }
[skin]:not(canvas-skin) { position: relative; isolation: isolate; }
.canvas-skin-veil { position: absolute !important; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; }
`;
// #endregion page-css

const skins = {};
let sheet = null;
function writeSheet() {
  if (typeof CSSStyleSheet === 'undefined' || typeof document === 'undefined') return;
  if (!sheet) { sheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  let css = BASE_CSS;
  for (const [name, skin] of Object.entries(skins)) {
    if (skin.root) css += `[skin="${name}"]:not(canvas-skin) { ${skin.root} }\n`;
    if (skin.type) css += `canvas-skin[now="${name}"] { ${skin.type} }\n`;
    if (skin.css) css += `canvas-skin[now="${name}"]:not([plain]) { ${skin.css} }\n`;
  }
  sheet.replaceSync(css);
}

const TEMPLATE = `
<style>
  :host { display: block; }
  :host([inline]) { display: inline-block; vertical-align: middle; }
  #box { position: relative; }
  canvas { position: absolute; left: -${BLEED}px; top: -${BLEED}px; width: calc(100% + ${2 * BLEED}px); height: calc(100% + ${2 * BLEED}px); pointer-events: none; }
  /* A child of a canvas is as wide as its content unless it is given a width. */
  #content { margin: ${BLEED}px; width: calc(100% - ${2 * BLEED}px); pointer-events: auto; }
  :host([inline]) #content { width: max-content; }
  :host([plain]) canvas { display: none; }
  :host([plain]) #box { width: auto !important; height: auto !important; }
  :host([plain]) #content { margin: 0; }
</style>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs id="filters"></defs></svg>
<div id="box"><canvas content="drawable" layoutsubtree><div id="content" drawable><slot></slot></div></canvas></div>`;

// Wrappers whose element changed size. All sizes are read, then all are written.
const dirty = new Set();
let dirtyFrame = 0;
function measureDirty() {
  dirtyFrame = 0;
  const list = [...dirty].map((el) => [el, el._size()]);
  dirty.clear();
  for (const [el, size] of list) if (size) el._measure(size);
}

// One plain canvas, shared by every wrapper, that holds the root background behind the element being painted.
let scratch = null;

let count = 0;
const live = new Set();        // connected wrappers
const applied = new WeakMap(); // root -> the skin name that apply() set, so the observer does not repeat it

// A skin root that changed size has moved its elements over its background, so the wrappers that
// draw that background are painted again.
const rootSizes = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => { for (const el of live) if (skins[el.getAttribute('now')]?.backdrop) el.request(); })
  : null;

// Far from the screen a wrapper gives its canvas memory back.
const nearby = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => { for (const e of entries) e.target._near(e.isIntersecting); }, { rootMargin: '100% 0px' })
  : null;

export class CanvasSkin extends HTMLElement {
  static supported = SUPPORTED;
  static skins = skins;
  static bleed = BLEED;
  static observedAttributes = ['skin', 'kind'];

  #canvas = null; #content = null; #box = null; #ctx = null; #filters = null;
  #near = true; #queued = 0; #retries = 0; #timer = 0;
  #cssW = 0; #cssH = 0;
  #t0 = -1e9; #old = null; #on = null; #hover = false; #down = false;
  #seed = ++count * 7919;
  paints = 0;
  plain = !SUPPORTED;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    if (!SUPPORTED) { root.innerHTML = '<slot></slot>'; return; }
    root.innerHTML = TEMPLATE;
    this.#canvas = root.querySelector('canvas');
    this.#content = root.getElementById('content');
    this.#box = root.getElementById('box');
    this.#filters = root.getElementById('filters');
    this.#ctx = this.#canvas.getContext('2d');
    if (!this.#ctx) { queueMicrotask(() => this.#toPlain('The canvas gave no 2D context.')); return; }

    this.#canvas.addEventListener('paint', () => this.#paint());
    // #region lost
    // A lost context: the element goes back into the page as plain HTML, with the skin's CSS only.
    this.#canvas.addEventListener('contextlost', () => this.#toPlain('The canvas lost its drawing context.'));
    // #endregion lost
    root.querySelector('slot').addEventListener('slotchange', () => this.refresh());
    // The size is applied in the next animation frame, for every wrapper at once. Applying it inside the
    // observer's callback resizes other observed elements (an outer wrapper, a neighbour in a flex row),
    // and the browser reports "ResizeObserver loop completed with undelivered notifications".
    new ResizeObserver(() => { dirty.add(this); dirtyFrame ||= requestAnimationFrame(measureDirty); }).observe(this.#content);

    // State a skin draws from. None of these listeners changes the element.
    const again = () => this.request();
    for (const type of ['input', 'change', 'focusin', 'focusout']) this.addEventListener(type, again);
    this.addEventListener('toggle', again, true);
    this.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { this.#hover = true; again(); } });
    this.addEventListener('pointerleave', () => { this.#hover = false; this.#down = false; again(); });
    this.addEventListener('pointerdown', () => { this.#down = true; again(); });
    for (const type of ['pointerup', 'pointercancel']) this.addEventListener(type, () => { this.#down = false; again(); });
  }

  /** The wrapped element. */
  get target() { return this.firstElementChild; }
  /** The canvas, for a check or a screenshot. Do not draw into it. */
  get canvas() { return this.#canvas; }

  connectedCallback() {
    live.add(this);
    if (this.plain) this.toggleAttribute('plain', true);
    const root = this.#root();
    if (root && !this.plain) rootSizes?.observe(root);
    if (!this.hasAttribute('now')) this.setAttribute('now', this.#wanted());
    this.refresh();
    nearby?.observe(this);
  }
  disconnectedCallback() {
    live.delete(this);
    nearby?.unobserve(this);
    cancelAnimationFrame(this.#queued); this.#queued = 0;
    clearTimeout(this.#timer);
    this.#freeOld();
  }
  attributeChangedCallback(name) {
    if (name === 'skin' && this.isConnected) this.change(this.#wanted());
    else this.request();
  }

  /** Read the wrapped element again: its kind, its layout and its size. */
  refresh() {
    const el = this.target;
    if (!el) return;
    const kind = this.getAttribute('kind') || kindOf(el);
    if (this.getAttribute('kind') !== kind) this.setAttribute('kind', kind);
    if (!this.hasAttribute('block')) this.toggleAttribute('inline', this.hasAttribute('inline') || INLINE.has(kind) || INLINE_TEXT.test(el.localName));
    this.request();   // the ResizeObserver measures the element before the next frame
  }

  // The nearest skin attribute, on this element or an ancestor.
  #wanted() { return this.closest('[skin]')?.getAttribute('skin') || 'native'; }
  #root() { return this.parentElement?.closest('[skin]:not(canvas-skin)') ?? null; }

  // #region size
  // The canvas is laid out by the wrapper, and the element is laid out inside the canvas. The box
  // takes the element's measured size, so the wrapper is as large as the element alone would be.
  _size() { return this.plain || !this.#content ? null : [this.#content.offsetWidth, this.#content.offsetHeight]; }
  _measure([w, h]) {
    const inline = this.hasAttribute('inline');
    if (!w || !h) return;
    if (inline) this.#box.style.width = `${w}px`; else this.#box.style.removeProperty('width');
    this.#box.style.height = `${h}px`;
    this.#cssW = w + 2 * BLEED; this.#cssH = h + 2 * BLEED;
    this.#resize();
  }
  #resize() {
    const canvas = this.#canvas;
    const pw = this.#near ? Math.round(this.#cssW * devicePixelRatio) : 0;
    const ph = this.#near ? Math.round(this.#cssH * devicePixelRatio) : 0;
    if (canvas.width !== pw) canvas.width = pw;       // assigned only when the size changed
    if (canvas.height !== ph) canvas.height = ph;
    this.request();
  }
  _near(near) {
    if (this.plain || near === this.#near) return;
    this.#near = near;
    if (!near) { this.#freeOld(); this.#t0 = -1e9; }
    this.#resize();
  }
  // #endregion size

  request() { if (!this.plain && this.#near) this.#canvas?.requestPaint?.(); }

  // #region change
  /** Change to a skin after `delay` ms. On screen, the old drawing is kept and faded out over the new one. */
  change(name, delay = 0) {
    clearTimeout(this.#timer);
    const go = () => {
      if (this.getAttribute('now') === name) return;
      const animate = !this.plain && this.#near && this.#canvas.width > 0 && this.paints > 0 && !reduced.matches;
      if (animate) {
        // A copy of the canvas as it is now, in a plain canvas. drawImage() of a drawable canvas is allowed.
        const old = this.#old ??= document.createElement('canvas');
        old.width = this.#canvas.width; old.height = this.#canvas.height;
        old.getContext('2d').drawImage(this.#canvas, 0, 0);
        this.#t0 = performance.now();
      }
      this.setAttribute('now', name);   // the skin's CSS for this element applies from here
      this.#on = null;
      this.request();
    };
    if (delay > 0) this.#timer = setTimeout(go, delay); else go();
  }
  #freeOld() {
    if (!this.#old) return;
    this.#old.width = this.#old.height = 0;
    window.__gfx?.retire?.(this.#old);
    this.#old = null;
  }
  // #endregion change

  // #region paint
  #paint() {
    const canvas = this.#canvas, ctx = this.#ctx, content = this.#content, el = this.target;
    if (this.plain || !el || !this.#cssW || !canvas.width || !canvas.height || ctx.isContextLost?.()) return;   // not measured yet
    const w = content.offsetWidth, h = content.offsetHeight;
    if (!w || !h) return;
    this.paints++;
    const name = this.getAttribute('now');
    const skin = skins[name] ?? skins.native;
    if (skin.filters && !this.#filters.querySelector(`[data-skin="${name}"]`)) this.#addFilters(name, skin);

    const kind = this.getAttribute('kind') || 'card';
    const control = CONTROL.has(kind);   // a kind that a skin draws whole
    const now = performance.now();
    const t = clamp((now - this.#t0) / ENTER_MS);
    let again = t < 1, missed = false;

    ctx.reset();
    ctx.scale(canvas.width / this.#cssW, canvas.height / this.#cssH);
    ctx.translate(BLEED, BLEED);        // 0, 0 is the element's top left corner, in CSS pixels

    // Every draw passes a width and height. An element has no picture before its first paint.
    const draw = ({ x = 0, y = 0, filter = null, alpha = 1 } = {}) => {
      ctx.save();
      if (filter) ctx.filter = filter;
      ctx.globalAlpha *= alpha;
      try { ctx.drawElementImage(content, x, y, w, h); } catch { missed = true; }
      ctx.restore();
    };

    // State, read from the element at paint time.
    const max = Number(el.max) || (el.localName === 'progress' ? 1 : 100), min = Number(el.min) || 0;
    const value = kind === 'range' || kind === 'bar' ? clamp((Number(el.value) - min) / ((max - min) || 1)) : 0;
    const checked = !!el.checked;
    if (this.#on === null) this.#on = checked ? 1 : 0;
    else if (Math.abs(this.#on - (checked ? 1 : 0)) > 0.02) { this.#on += ((checked ? 1 : 0) - this.#on) * 0.3; again = true; }
    else this.#on = checked ? 1 : 0;

    let rootBox = null;
    const root = skin.backdrop ? this.#root() : null;
    if (root) {
      const a = this.#box.getBoundingClientRect(), b = root.getBoundingClientRect();
      rootBox = { x: a.left - b.left - root.clientLeft, y: a.top - b.top - root.clientTop, width: root.clientWidth, height: root.clientHeight };
    }

    const frame = {
      width: w, height: h, kind, el, t, time: now / 1000, seed: this.#seed, bleed: BLEED,
      primary: el.matches('.primary, [type="submit"]'),
      heading: /^h[1-6]$/.test(el.localName),
      state: {
        checked, on: this.#on, value, disabled: el.matches(':disabled'), open: !!el.open,
        focus: (control || kind === 'button' || kind === 'field') && el.matches(':focus-visible'),
        hover: this.#hover, active: this.#down && !el.matches(':disabled'),
      },
      draw,
      again: false,
      // Draw the skin root's background where it lies behind this element, enlarged by `scale` about cx, cy.
      backdrop: (scale = 1, cx = w / 2, cy = h / 2) => {
        if (!rootBox) return false;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
        ctx.translate(-rootBox.x, -rootBox.y);
        skin.backdrop(ctx, rootBox, { x: rootBox.x - BLEED, y: rootBox.y - BLEED, width: w + 2 * BLEED, height: h + 2 * BLEED });
        ctx.restore();
        return true;
      },
      // The same background as an image, for a skin that draws it several times: { image, sx, sy, sw, sh } in
      // the image's pixels, covering x, y, width, height in the element's CSS pixels. Valid until the next paint.
      backdropCopy: (pad = BLEED) => {
        if (!rootBox) return null;
        const k = canvas.width / this.#cssW, cw = Math.ceil((w + 2 * pad) * k), ch = Math.ceil((h + 2 * pad) * k);
        scratch ??= document.createElement('canvas');
        if (scratch.width < cw) scratch.width = cw;      // it only grows
        if (scratch.height < ch) scratch.height = ch;
        const c = scratch.getContext('2d');
        c.setTransform(k, 0, 0, k, 0, 0);
        c.translate(pad - rootBox.x, pad - rootBox.y);
        skin.backdrop(c, rootBox, { x: rootBox.x - pad, y: rootBox.y - pad, width: w + 2 * pad, height: h + 2 * pad });
        return { image: scratch, sx: 0, sy: 0, sw: cw, sh: ch, x: -pad, y: -pad, width: cw / k, height: ch / k };
      },
    };

    ctx.save();
    if (frame.state.disabled && skin !== skins.native) ctx.globalAlpha = 0.45;
    skin.paint(ctx, frame);
    ctx.restore();
    again ||= frame.again;

    // Input goes to the element's place in the layout, whatever the skin drew and wherever. A draw
    // inside an empty clip moves the hit region there and adds no pixels.
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); draw(); ctx.restore();

    // The copy of the old skin's drawing, fading out over the new one.
    if (this.#old) {
      if (t < 1) {
        ctx.save(); ctx.resetTransform();
        ctx.globalAlpha = 1 - clamp(t / 0.6) ** 2;
        ctx.drawImage(this.#old, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else this.#freeOld();
    }

    if (missed && this.#retries++ < 60) again = true; else if (!missed) this.#retries = 0;
    if (again && !this.#queued) this.#queued = requestAnimationFrame(() => { this.#queued = 0; this.request(); });
  }
  // #endregion paint

  // ctx.filter = 'url(#id)' looks for the filter in the canvas's own tree, so each wrapper carries
  // the filters of the skins it has drawn.
  #addFilters(name, skin) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-skin', name);
    g.innerHTML = skin.filters;
    this.#filters.append(g);
  }

  #toPlain(why) {
    if (this.plain) return;
    this.plain = true;
    cancelAnimationFrame(this.#queued); this.#queued = 0;
    this.#freeOld();
    this.#box.append(this.#content);            // out of the canvas, still holding the slot
    this.toggleAttribute('plain', true);
    this.dispatchEvent(new CustomEvent('canvas-skin-plain', { bubbles: true, composed: true, detail: { why } }));
  }

  // ------------------------------------------------------------------ static API

  /** Register a skin: { label, type, root, css, filters, backdrop(ctx, root, region), paint(ctx, frame) }. */
  static define(name, skin) { skins[name] = skin; writeSheet(); for (const el of live) el.request(); }

  // #region wrap
  /** Put a <canvas-skin> round every matching element under `root` that is not inside one already. */
  static wrap(root, selector = 'button, input, select, textarea, progress, meter, img, table, details, fieldset, h1, h2, h3, h4, p, label, output') {
    const made = [];
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('canvas-skin')) continue;
      const wrapper = document.createElement('canvas-skin');
      el.before(wrapper);
      wrapper.append(el);
      wrapper.refresh();
      made.push(wrapper);
    }
    return made;
  }
  // #endregion wrap

  // #region apply
  /**
   * Set `root`'s skin. Each wrapper under it changes when a circle growing from the client point
   * x, y at `speed` px per ms reaches it. The root's old background is kept on a layer whose mask
   * has a hole growing at the same speed.
   */
  static apply(root, name, { x, y, speed = 0.8, maxDelay = 1200 } = {}) {
    const from = root.getAttribute('skin');
    if (from === name) return;
    const box = root.getBoundingClientRect();
    x ??= box.left + box.width / 2;
    y ??= Math.max(box.top, 0);
    const still = reduced.matches;

    if (from && !still && typeof CSS !== 'undefined' && CSS.registerProperty) {
      registerRadius();
      root.querySelector(':scope > .canvas-skin-veil')?.remove();
      const veil = document.createElement('div');
      veil.className = 'canvas-skin-veil';
      veil.setAttribute('skin', from);
      veil.setAttribute('aria-hidden', 'true');
      const ox = x - box.left - root.clientLeft, oy = y - box.top - root.clientTop;
      veil.style.maskImage = `radial-gradient(circle at ${ox}px ${oy}px, transparent calc(var(--canvas-skin-r) - 70px), #000 var(--canvas-skin-r))`;
      root.append(veil);
      // Far enough to cover what is on screen. The rest of a tall root is not visible while it runs.
      const reach = Math.min(Math.hypot(Math.max(ox, box.width - ox), Math.max(oy, box.height - oy)), Math.hypot(innerWidth, innerHeight)) + 80;
      const run = veil.animate({ '--canvas-skin-r': ['0px', `${reach}px`] }, { duration: reach / speed, easing: 'linear', fill: 'forwards' });
      run.finished.then(() => veil.remove(), () => veil.remove());
    }

    applied.set(root, name);
    root.setAttribute('skin', name);
    for (const el of root.querySelectorAll('canvas-skin')) {
      if (el.closest('[skin]') !== root) continue;          // it has a skin of its own, or a nearer root
      const r = el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      el.change(name, still ? 0 : Math.min(d / speed, maxDelay));
    }
  }
  // #endregion apply
}

let radiusRegistered = false;
function registerRadius() {
  if (radiusRegistered) return;
  radiusRegistered = true;
  try { CSS.registerProperty({ name: '--canvas-skin-r', syntax: '<length>', inherits: false, initialValue: '0px' }); } catch { /* registered by another copy of this module */ }
}

for (const [name, skin] of Object.entries(themes.skins)) skins[name] = skin;
writeSheet();

if (typeof document !== 'undefined') {
  // skin="…" set on an ancestor without apply(): every wrapper under it changes, top to bottom.
  new MutationObserver((records) => {
    for (const { target } of records) {
      if (target.localName === 'canvas-skin' || target.classList.contains('canvas-skin-veil')) continue;
      const name = target.getAttribute('skin') || 'native';
      if (applied.get(target) === name) { applied.delete(target); continue; }
      let i = 0;
      for (const el of target.querySelectorAll('canvas-skin')) if (el.closest('[skin]') === target) el.change(name, reduced.matches ? 0 : Math.min(i++ * 35, 900));
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['skin'], subtree: true });

  if (!customElements.get('canvas-skin')) customElements.define('canvas-skin', CanvasSkin);
}
