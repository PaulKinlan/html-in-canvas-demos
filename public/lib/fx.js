// fx: draw any HTML element through a fragment shader with one attribute.
//
//   <script type="module" src="https://html-in-canvas.page/lib/fx.js"></script>
//   <button fx="ripple">Still a button</button>
//
// Needs the HTML-in-canvas API (Chrome with chrome://flags/#canvas-draw-element).
// Without it the page is left as plain HTML.
// Instructions and a live editor: https://html-in-canvas.page/shader-css/
//
// GENERATED FILE. Do not edit. Built by tools/bundle/fx.mjs from:
//   public/lib/surface.js
//   public/lib/effects.js
//   public/lib/gpu-util.js
//   public/shared/backend.js
//   public/lib/shader-fx.js

// ---- public/lib/surface.js ----
const m1 = (() => {
// SurfaceElement: the shared base for the "new UI primitive" elements
// (<dom-lens>, <fx-surface>, <physical-ui>).
//
// It answers one question once: "how do I get somebody's ordinary markup into
// an HTML-in-canvas canvas without them changing it?"
//
//   <my-surface>            light DOM, written by the author, untouched
//     <form>…</form>
//   </my-surface>
//
//   #shadow-root
//     <div id="sizer">      holds the host open at the content's height
//     <canvas content="drawable">
//       <div id="content" drawable><slot></slot></div>
//     </canvas>
//
// The slotted children lay out inside #content (flat tree), #content is the one
// drawable element, and the canvas sits exactly over the host (plus an optional
// "bleed" margin so effects can spill outside the box). Subclasses implement
// render(time) and draw #content with a 2D or WebGL context.
//
// Without HTML-in-canvas the shadow root is just <slot>, so the page is plain
// HTML and nothing breaks.

const supported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

const supportedGL =
  supported &&
  typeof WebGL2RenderingContext !== 'undefined' &&
  'texElementSubImage2D' in WebGL2RenderingContext.prototype;

const MAX_DIM = 8192;
const MAX_AREA = 16e6;

const CSS = `
  :host { display: block; position: relative; }
  :host([inline]) { display: inline-block; vertical-align: top; }
  :host([hidden]) { display: none; }
  #sizer { pointer-events: none; }
  canvas {
    --surface-bleed: 0px;
    position: absolute; display: block; pointer-events: none;
    left: calc(-1 * var(--surface-bleed)); top: calc(-1 * var(--surface-bleed));
    width: calc(100% + 2 * var(--surface-bleed)); height: calc(100% + 2 * var(--surface-bleed));
  }
  #content {
    position: absolute; left: var(--surface-bleed); top: var(--surface-bleed);
    width: calc(100% - 2 * var(--surface-bleed));
    display: flow-root; box-sizing: border-box; pointer-events: auto;
  }
  :host([inline]) #content { width: max-content; }
`;

class SurfaceElement extends HTMLElement {
  /**
   * '2d' or 'webgl2'. Subclasses may also override createContext(), which may
   * return a promise (choosing WebGPU means asking for a device first).
   */
  static contextType = '2d';
  static contextAttributes = undefined;
  static defaultBleed = 0;

  static get supported() {
    return this.contextType === '2d' ? supported : supportedGL;
  }

  /**
   * Wrap an arbitrary element in this surface, in place, and return the host.
   * The element keeps its identity, listeners, state and styles; only its
   * parent changes.
   */
  static adopt(target, attributes = {}) {
    const tag = customElements.getName?.(this);
    if (!tag) throw new Error('define the element before calling adopt()');
    const existing = target.parentElement;
    if (existing && existing.localName === tag && existing.children.length === 1) return existing;
    const host = document.createElement(tag);
    const cs = getComputedStyle(target);
    const ps = target.parentElement ? getComputedStyle(target.parentElement) : null;
    const isItem = /flex|grid/.test(ps?.display ?? '');
    // Grid items and column-flex items normally stretch across their track, so
    // the host fills it like a block. Row-flex items are sized by their content.
    const stretches = isItem && (/grid/.test(ps.display) || ps.flexDirection.startsWith('column')) && /normal|stretch|auto/.test(/grid/.test(ps.display) ? cs.justifySelf : cs.alignSelf);
    if (cs.display.startsWith('inline') || (isItem && !stretches)) host.setAttribute('inline', '');
    if (isItem) {
      for (const p of ['flex', 'align-self', 'justify-self', 'order', 'grid-area']) host.style.setProperty(p, cs.getPropertyValue(p));
    }
    for (const [k, v] of Object.entries(attributes)) host.setAttribute(k, v);
    // #region move
    // moveBefore() moves a connected node without removing it: focus, a loaded
    // iframe and running transitions inside the element carry on. Older
    // browsers remove and re-insert it, and focus is put back by hand.
    if ('moveBefore' in Element.prototype && target.isConnected) {
      target.before(host);
      try {
        host.moveBefore(target, null);
        return host;
      } catch {
        host.remove();
      }
    }
    const hadFocus = target.contains(document.activeElement) ? document.activeElement : null;
    target.replaceWith(host);
    host.append(target);
    hadFocus?.focus({ preventScroll: true });
    // #endregion move
    return host;
  }

  /** Undo adopt(): put the children back where the host is. */
  static release(host) {
    host.replaceWith(...host.childNodes);
  }

  #root;
  #sizer = null;
  #observers = [];
  #raf = 0;
  #painted = false;
  #sized = false;
  #canvasRO = null;
  #starting = 0;

  /** True when the canvas path is active (false: plain <slot> fallback). */
  live = false;
  canvas = null;
  content = null;
  ctx = null;
  /** Canvas pixels per CSS pixel. */
  scale = 1;
  /** Content box size in CSS px. */
  width = 0;
  height = 0;
  bleed = 0;
  /** Set when the DOM inside changed; subclasses clear it once consumed. */
  contentDirty = true;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.live = this.constructor.supported;
    if (!this.live) {
      this.#root.innerHTML = '<slot></slot>';
      return;
    }
    this.#build();
  }

  #build() {
    // #region wrap
    this.#root.innerHTML = `<style>${CSS}</style><div id="sizer"></div><canvas part="canvas" content="drawable" layoutsubtree><div id="content" part="content" drawable><slot></slot></div></canvas>`;
    // #endregion wrap
    this.#sizer = this.#root.getElementById('sizer');
    this.canvas = this.#root.querySelector('canvas');
    this.content = this.#root.getElementById('content');
    this.#wire(this.canvas);
  }

  #wire(canvas) {
    canvas.addEventListener('paint', () => {
      if (canvas !== this.canvas) return;
      this.#painted = true;
      this.contentDirty = true;
      // Draw in the same frame as the DOM change rather than one frame late.
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
      this.#frame(performance.now());
    });
    // A 2D canvas can lose its context too (GPU reset, memory pressure on a
    // phone). Give it a moment to come back, then show the plain element.
    let lost = 0;
    canvas.addEventListener('contextlost', () => {
      if (canvas !== this.canvas) return;
      lost = setTimeout(() => canvas === this.canvas && this.fallBackToPlain('canvas context lost'), 1500);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lost);
      if (canvas !== this.canvas) return;
      this.contentDirty = true;
      this.canvas.requestPaint();
      this.invalidate();
    });
  }

  /**
   * Start again on a new canvas. A canvas keeps the first kind of context it
   * is given, so moving between 2D, WebGL and WebGPU (or leaving a dead
   * context behind) means a fresh one. The content moves across untouched and
   * createContext() is asked again.
   */
  swapCanvas() {
    if (!this.live || !this.canvas) return;
    const old = this.canvas;
    const canvas = old.cloneNode(false);
    canvas.append(...old.childNodes);
    this.#canvasRO?.unobserve(old);
    old.replaceWith(canvas);
    this.canvas = canvas;
    this.ctx = null;
    this.#painted = false;
    this.contentDirty = true;
    this.#wire(canvas);
    if (this.#canvasRO) this.#observeCanvas();
    if (this.isConnected) this.#startContext(false);
  }

  #observeCanvas() {
    try {
      this.#canvasRO.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#canvasRO.observe(this.canvas);
    }
  }

  // createContext() may answer later. Sizing does not wait for it: only drawing does.
  #startContext(first) {
    const token = ++this.#starting;
    const go = (ctx) => {
      if (token !== this.#starting || !this.isConnected || !this.live) return;
      this.ctx = ctx;
      if (!ctx) return this.fallBackToPlain('no context');
      if (first) this.connected?.();
      this.contentDirty = true;
      this.canvas.requestPaint();
      this.invalidate();
    };
    if (this.ctx) return go(this.ctx);
    let made;
    try {
      made = this.createContext(this.canvas);
    } catch (err) {
      return this.fallBackToPlain(err.message);
    }
    if (made && typeof made.then === 'function') made.then(go, (err) => token === this.#starting && this.fallBackToPlain(err.message));
    else go(made);
  }

  /** Switch to the plain fallback at runtime (e.g. the GL context was lost for good). */
  fallBackToPlain(reason) {
    if (!this.live) return;
    this.live = false;
    this.#teardown();
    // Say so on the page: plain HTML with a note beats an empty box.
    this.#root.innerHTML = '<slot></slot><small part="notice" style="display:block;font:11px system-ui;opacity:.7;margin-top:2px"></small>';
    this.#root.querySelector('small').textContent = `Shown as plain HTML (${reason}).`;
    this.setAttribute('plain', reason);
    this.dispatchEvent(new CustomEvent('surfacefallback', { detail: { reason }, bubbles: true }));
  }

  connectedCallback() {
    if (!this.live) return;
    this.bleed = Number(this.getAttribute('bleed') ?? this.constructor.defaultBleed) || 0;
    this.canvas.style.setProperty('--surface-bleed', this.bleed + 'px');
    const contentRO = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      const w = box ? box.inlineSize : entry.contentRect.width;
      const h = box ? box.blockSize : entry.contentRect.height;
      this.width = w;
      this.height = h;
      this.#sizer.style.height = h + 'px';
      this.#sizer.style.width = this.hasAttribute('inline') ? w + 'px' : '';
    });
    contentRO.observe(this.content);

    const canvasRO = new ResizeObserver(([entry]) => {
      const cssW = entry.contentRect.width;
      const cssH = entry.contentRect.height;
      if (!cssW || !cssH) return;
      const box = entry.devicePixelContentBoxSize?.[0];
      let w = box ? box.inlineSize : Math.round(cssW * devicePixelRatio);
      let h = box ? box.blockSize : Math.round(cssH * devicePixelRatio);
      const k = Math.min(1, MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      // Capping rounds the two sides separately; use the smaller ratio so the
      // far edge of a very tall or wide element is not cut off.
      this.scale = Math.min(w / cssW, h / cssH);
      this.#sized = true;
      this.contentDirty = true;
      this.resized?.();
      this.canvas.requestPaint();
      this.invalidate();
    });
    this.#canvasRO = canvasRO;
    this.#observeCanvas();
    this.#observers.push(contentRO, canvasRO);
    this.#startContext(true);
  }

  disconnectedCallback() {
    this.#teardown();
    this.disconnected?.();
  }

  #teardown() {
    this.#starting++;
    for (const o of this.#observers) o.disconnect();
    this.#observers = [];
    this.#canvasRO = null;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  createContext(canvas) {
    return canvas.getContext(this.constructor.contextType, this.constructor.contextAttributes);
  }

  get ready() {
    return this.live && !!this.ctx && this.#painted && this.#sized && this.width > 0;
  }

  /** Ask for a render on the next animation frame. */
  invalidate() {
    if (this.#raf || !this.live || !this.isConnected) return;
    this.#raf = requestAnimationFrame((t) => {
      this.#raf = 0;
      this.#frame(t);
    });
  }

  #frame(time) {
    if (!this.ready) return;
    let again = false;
    try {
      again = this.render(time);
    } catch (err) {
      // "No cached paint record": the element has not painted yet. Ask again.
      if (/paint record/i.test(err?.message ?? '')) this.canvas.requestPaint();
      else {
        this.lastError = err;
        console.error(err);
      }
    }
    if (again) this.invalidate();
  }

  /** Subclasses draw here. Return true to keep animating. */
  render(_time) {
    return false;
  }

  /**
   * Tell the browser where the content really is, so hit testing, focus rings
   * and getBoundingClientRect() follow what was drawn. `matrix` maps content
   * CSS px to canvas CSS px (the content's rest position is translate(bleed, bleed)).
   */
  // #region geometry
  setGeometry(matrix) {
    const m = new DOMMatrix().scale(geometryUnit(this.canvas, this.content, this.width)).multiply(matrix ?? this.restMatrix);
    this.canvas.updateElementGeometry(this.content, { canvasTransform: m });
  }
  // #endregion geometry

  get restMatrix() {
    return new DOMMatrix().translate(this.bleed, this.bleed);
  }

  /** Pointer position in content CSS px (origin: the host's top-left corner). */
  localPoint(event) {
    const r = this.getBoundingClientRect();
    const z = cssZoom(this);
    return { x: (event.clientX - r.left) / z, y: (event.clientY - r.top) / z };
  }
}

const units = new WeakMap();

/** The CSS zoom in effect on an element (1 where the zoom property is not used). */
function cssZoom(element) {
  return element.currentCSSZoom || 1;
}

/**
 * updateElementGeometry()'s canvasTransform has been seen to work in CSS pixels
 * on some canvases and in canvas-buffer pixels on others, which only shows up
 * when the two differ (any high-DPI screen). Rather than guess, measure: apply
 * the identity, see how wide the element says it is, and return the factor
 * that makes one unit one CSS pixel. Cached until the canvas changes size.
 */
function geometryUnit(canvas, element, cssWidth) {
  // getBoundingClientRect() includes CSS zoom and cssWidth (layout px) does
  // not, so the target is the zoomed width.
  const zoom = cssZoom(element);
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${Math.round(cssWidth)}/${zoom}`;
  const cached = units.get(canvas);
  if (cached?.key === key) return cached.unit;
  let unit = cached?.unit ?? 1;
  try {
    canvas.updateElementGeometry(element, { canvasTransform: new DOMMatrix() });
    const measured = element.getBoundingClientRect().width;
    if (measured > 0 && cssWidth > 0) {
      unit = (cssWidth * zoom) / measured;
      units.set(canvas, { key, unit });
    }
  } catch {}
  return unit;
}

/** Compile a WebGL2 program; throws with the shader log on failure. */
function program(gl, vertexSrc, fragmentSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      // A context on its way out fails with no log, sometimes before isContextLost() says so.
      if (gl.isContextLost() || !log) throw new Error('WebGL context lost');
      throw new Error('shader compile failed: ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  return p;
}

/**
 * Keep a WebGL texture in sync with a drawable element. texElementSubImage2D
 * needs storage allocated at exactly the element's default image size.
 */
// #region texture
class ElementTexture {
  constructor(gl, canvas, element) {
    this.gl = gl;
    this.canvas = canvas;
    this.element = element;
    this.texture = gl.createTexture();
    this.width = 0;
    this.height = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Upload the element's current rendering. Row 0 of the texture is the element's top. */
  update() {
    const { gl } = this;
    const size = this.canvas.getElementImageDefaultSize(this.element);
    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (w !== this.width || h !== this.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.width = w;
      this.height = h;
    }
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.element);
  }
}
// #endregion texture
return { supported, supportedGL, SurfaceElement, cssZoom, geometryUnit, program, ElementTexture };
})();

// ---- public/lib/effects.js ----
const m2 = (() => {
// The effect registry shared by the fx attribute (shader-fx.js) and
// <canvas-slot effect> (slot-effects.js). One list of names, one shader
// contract, one set of CSS custom properties.
//
//   import { defineEffect } from '/lib/effects.js';
//   defineEffect('wobble', {
//     glsl: `vec4 fx(vec2 p) { return tex(p + vec2(sin(p.y * 0.1 + u_time * 4.0) * 4.0, 0.0)); }`,
//   });
//
//   <button fx="wobble">…</button>
//   <canvas-slot effect="wobble">…</canvas-slot>
//
// An effect is a GLSL function. `p` is in CSS pixels from the element's
// top-left, and tex(p) samples the element (premultiplied, clear outside).
//
//   glsl       vec4 fx(vec2 p)                         required
//   wgsl       fn fx(p: vec2f) -> vec4f                optional, for backend="webgpu"
//   animated   redraw every frame (default: true when the source mentions u_time)
//   geometry   ({ width, height, pointer, hover, progress, amount, x, y }) => DOMMatrix
//              Where the element appears, so hit testing can follow it. The
//              shader gets the inverse as unproject(p).
//   bleed      extra canvas around the element, px (fx attribute only)
//
// Uniforms: u_size (element size, px), u_time (s), u_pointer (px, far away when
// absent), u_hover (0..1, eased), u_progress, u_amount, u_xy, u_clicks[4]
// (x, y, age in seconds).
//
// CSS drives them. These are registered custom properties, so transitions,
// animations, :hover and media queries all work:
//
//   --fx-progress  0..1    u_progress
//   --fx-amount    number  u_amount (strength, default 1)
//   --fx-x, --fx-y number  u_xy (tilt direction, -1..1)
//
// An effect can be declared in markup, with no script of your own. One
// <script> per language, with a type the browser will not run:
//
//   <script type="text/glsl" data-effect="wobble">vec4 fx(vec2 p) { … }</script>
//   <script type="text/wgsl" data-effect="wobble">fn fx(p: vec2f) -> vec4f { … }</script>
//   <button fx="wobble">…</button>
//
// The effect attribute can also point at a shader instead of naming one:
//
//   effect="#my-shader"          <script type="x-shader/x-fragment" id="my-shader">
//   effect="url(/fx/wobble.frag)" a file holding the fx() function

const { program } = m1;

const effects = new Map();
const listeners = new Set();

/** Register an effect. { glsl, wgsl?, animated?, bleed?, geometry? } */
function defineEffect(name, def) {
  // WGSL only: WebGL draws the element unshaded instead of failing to compile nothing.
  if (!def.glsl && def.wgsl && effects.has('none')) def = { ...def, glsl: effects.get('none').glsl };
  const source = (def.glsl ?? '') + (def.wgsl ?? '');
  effects.set(name, { animated: /\bu_time\b|\bu\.time\b/.test(source), bleed: 0, ...def });
  for (const fn of listeners) fn(name);
}

/** Call fn(name) whenever an effect is defined or redefined. Returns an unsubscribe function. */
function onEffectChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const loading = new Map();

/**
 * Turn an attribute value into a registered effect name. Names resolve to
 * themselves; "#id" reads a <script> element; "url(…)" (or anything that looks
 * like a path) is fetched, and resolves to 'none' until it arrives.
 */
function resolveEffect(value, doc = document) {
  const raw = (value ?? '').trim();
  if (!raw) return 'none';
  if (effects.has(raw)) return raw;
  // #region declared
  // A name nobody registered: look for <script data-effect="name"> elements
  // holding the source. One per language, told apart by the type attribute.
  if (/^[\w-]+$/.test(raw)) {
    const def = {};
    for (const el of doc.querySelectorAll(`script[data-effect="${raw}"]`)) {
      def[/wgsl/i.test(el.type) ? 'wgsl' : 'glsl'] = el.textContent;
      if (el.dataset.bleed) def.bleed = Number(el.dataset.bleed) || 0;
    }
    if (def.glsl || def.wgsl) {
      // WGSL only: WebGL draws the element unshaded.
      def.glsl ??= effects.get('none').glsl;
      defineEffect(raw, def);
      return raw;
    }
  }
  // #endregion declared
  if (raw.startsWith('#')) {
    const el = doc.getElementById(raw.slice(1));
    if (!el) return 'none';
    const lang = /wgsl/i.test(el.type) ? 'wgsl' : 'glsl';
    defineEffect(raw, { [lang]: el.textContent, ...(lang === 'wgsl' ? { glsl: effects.get('none').glsl } : {}) });
    return raw;
  }
  const url = raw.match(/^url\(\s*['"]?(.*?)['"]?\s*\)$/)?.[1] ?? (/[/.]/.test(raw) ? raw : null);
  if (!url) return 'none';
  if (!loading.has(raw)) {
    loading.set(
      raw,
      fetch(new URL(url, doc.baseURI))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} for ${url}`))))
        .then((text) => defineEffect(raw, /\.wgsl$/i.test(url) ? { wgsl: text, glsl: effects.get('none').glsl } : { glsl: text }))
        .catch((err) => console.warn(`effect ${raw}: ${err.message}`)),
    );
  }
  return 'none';
}

if (typeof CSS !== 'undefined' && CSS.registerProperty) {
  for (const [name, initialValue] of [['--fx-progress', '0'], ['--fx-amount', '1'], ['--fx-x', '0'], ['--fx-y', '0']]) {
    try {
      CSS.registerProperty({ name, syntax: '<number>', inherits: true, initialValue });
    } catch {}
  }
}

/** Read the CSS-driven parameters off an element. */
function readParams(el) {
  const cs = getComputedStyle(el);
  const num = (name, fallback) => {
    const v = cs.getPropertyValue(name);
    return v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
  };
  return { progress: num('--fx-progress', 0), amount: num('--fx-amount', 1), x: num('--fx-x', 0), y: num('--fx-y', 0) };
}

const reducedMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
const effectTime = () => (reducedMotion.matches ? 0 : (performance.now() - t0) / 1000);

/** Pointer, hover and click state for one shaded element. */
class Interaction {
  pointer = null;
  hover = 0;
  clicks = [];
  move(p) {
    this.pointer = p;
  }
  leave() {
    this.pointer = null;
  }
  down(p) {
    this.clicks.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.clicks.length > 4) this.clicks.shift();
  }
  /** Advance one frame. Returns the uniform values and whether anything is still moving. */
  step() {
    const still = reducedMotion.matches;
    const target = this.pointer ? 1 : 0;
    this.hover += (target - this.hover) * (still ? 1 : 0.18);
    if (Math.abs(target - this.hover) < 0.004) this.hover = target;
    const now = performance.now();
    this.clicks = this.clicks.filter((c) => now - c.t < 2600);
    const clicks = new Float32Array(16).fill(-1);
    this.clicks.forEach((c, i) => clicks.set([c.x, c.y, still ? -1 : (now - c.t) / 1000, 0], i * 4));
    return { hover: this.hover, pointer: this.pointer ?? { x: -1e4, y: -1e4 }, clicks, moving: this.clicks.length > 0 || this.hover !== target };
  }
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * The inverse of a DOMMatrix restricted to the z = 0 plane, as a column-major
 * mat3: it takes a point on screen back to the point of the element shown there.
 */
function inverseHomography(m) {
  if (!m || m.isIdentity) return IDENTITY3;
  // Forward: [x', y', w] = H · [x, y, 1]
  const a = m.m11, b = m.m21, c = m.m41;
  const d = m.m12, e = m.m22, f = m.m42;
  const g = m.m14, h = m.m24, i = m.m44;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return IDENTITY3;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  // inv is row-major; GL wants columns.
  return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
}

// ---- GLSL ----------------------------------------------------------------

const VERT = `#version 300 es
layout(location = 0) in vec2 a;
uniform vec2 u_canvas; // canvas size in CSS px
uniform vec2 u_origin; // where the element's top-left is on the canvas
out vec2 v_p;
void main() {
  v_p = (a * 0.5 + 0.5) * u_canvas;
  v_p.y = u_canvas.y - v_p.y;
  v_p -= u_origin;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_texOrigin; // element px -> texture px offset
uniform vec2 u_texSize;   // texture extent in element px
uniform vec2 u_size;
uniform float u_time, u_progress, u_amount, u_hover;
uniform vec2 u_pointer, u_xy;
uniform vec4 u_clicks[4];
uniform mat3 u_inv;
vec4 tex(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) return vec4(0.0);
  return texture(u_tex, (p + u_texOrigin) / u_texSize);
}
// Screen position -> the point of the element drawn there (see "geometry").
vec2 unproject(vec2 p) { vec3 q = u_inv * vec3(p, 1.0); return q.xy / q.z; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const FRAG_TAIL = `
void main() { o = fx(v_p); }`;

const UNIFORMS = ['u_canvas', 'u_origin', 'u_tex', 'u_texOrigin', 'u_texSize', 'u_size', 'u_time', 'u_progress', 'u_amount', 'u_hover', 'u_pointer', 'u_xy', 'u_clicks', 'u_inv'];

function setupQuad(gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
}

/**
 * One page-wide WebGL context for surfaces that cannot have their own (a page
 * only gets about 16). Draw into it, then copy the result out.
 */
const sharedGL = {
  canvas: null,
  gl: null,
  programs: new Map(),
  texture: null,
  ensure() {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    this.programs = new Map();
    this.texture = null;
    if (this.gl) setupQuad(this.gl);
    return this.gl;
  },
  /** The scratch texture, bound to unit 0 and loaded from a canvas. */
  upload(source) {
    const gl = this.gl;
    if (!this.texture) {
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  },
};

/** Compile (and cache per context) the program for a named effect. Throws with the shader log. */
function compileEffect(gl, cache, name) {
  // A lost context fails every compile with an empty log. That is not a
  // broken shader, so do not remember it as one.
  if (gl.isContextLost()) throw new Error('WebGL context lost');
  let entry = cache.get(name);
  const def = effects.get(name);
  if (entry && entry.def === def) {
    if (entry.error) throw entry.error;
    return entry;
  }
  try {
    const p = program(gl, VERT, FRAG_HEAD + def.glsl + FRAG_TAIL);
    const u = {};
    for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
    entry = { program: p, u, def };
  } catch (error) {
    if (/context lost/i.test(error.message)) throw error;
    // Remember the failure so a broken shader is not recompiled every frame.
    cache.set(name, { def, error });
    throw error;
  }
  cache.set(name, entry);
  return entry;
}

/** Set every uniform of the contract. All lengths are CSS px. */
function setEffectUniforms(gl, u, v) {
  gl.uniform2f(u.u_canvas, v.canvas[0], v.canvas[1]);
  gl.uniform2f(u.u_origin, v.origin[0], v.origin[1]);
  gl.uniform1i(u.u_tex, 0);
  gl.uniform2f(u.u_texOrigin, v.texOrigin[0], v.texOrigin[1]);
  gl.uniform2f(u.u_texSize, v.texSize[0], v.texSize[1]);
  gl.uniform2f(u.u_size, v.size[0], v.size[1]);
  gl.uniform1f(u.u_time, v.time);
  gl.uniform1f(u.u_progress, v.progress);
  gl.uniform1f(u.u_amount, v.amount);
  gl.uniform1f(u.u_hover, v.hover);
  gl.uniform2f(u.u_pointer, v.pointer.x, v.pointer.y);
  gl.uniform2f(u.u_xy, v.x ?? 0, v.y ?? 0);
  gl.uniform4fv(u.u_clicks, v.clicks);
  gl.uniformMatrix3fv(u.u_inv, false, v.inv ?? IDENTITY3);
}

// ---- WGSL (backend="webgpu") ---------------------------------------------

const WGSL_HEAD = `
struct U {
  canvas: vec2f, origin: vec2f, size: vec2f, texSize: vec2f, pointer: vec2f, xy: vec2f,
  time: f32, progress: f32, amount: f32, hover: f32, scale: f32,
  inv: mat3x3f,
  clicks: array<vec4f, 4>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fx_sampler: sampler;
@group(0) @binding(2) var fx_texture: texture_2d<f32>;
fn tex(p: vec2f) -> vec4f {
  let c = textureSampleLevel(fx_texture, fx_sampler, p / u.texSize, 0.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x > u.size.x || p.y > u.size.y) { return vec4f(0.0); }
  return c;
}
fn unproject(p: vec2f) -> vec2f { let q = u.inv * vec3f(p, 1.0); return q.xy / q.z; }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), f.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn fbm(p0: vec2f) -> f32 { var v = 0.0; var a = 0.5; var p = p0; for (var i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const WGSL_TAIL = `
@vertex fn fx_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fx_fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return fx(pos.xy / u.scale - u.origin);
}`;
/** Byte size of the U struct above. */
const WGSL_UNIFORM_SIZE = 192;

/** Pack the uniform values (same object as setEffectUniforms) into the U struct. */
function packWGSLUniforms(v, scale) {
  const f = new Float32Array(WGSL_UNIFORM_SIZE / 4);
  f.set([v.canvas[0], v.canvas[1], v.origin[0], v.origin[1], v.size[0], v.size[1], v.texSize[0], v.texSize[1], v.pointer.x, v.pointer.y, v.x ?? 0, v.y ?? 0, v.time, v.progress, v.amount, v.hover, scale], 0);
  const m = v.inv ?? IDENTITY3;
  f.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 20); // offset 80
  f.set(v.clicks, 32); // offset 128
  return f;
}

/** True when a registered effect also has WGSL source, so WebGPU can draw it. */
function hasWGSL(name) {
  return !!effects.get(name)?.wgsl;
}

const gpuPipelines = new WeakMap(); // GPUDevice -> Map("name|format" -> { def, pipeline, error })

/**
 * The render pipeline for a named effect on a device (cached per device).
 * Throws when the effect has no WGSL, or when an earlier compile of it failed.
 * Bind group 0: the U uniform buffer, a sampler, the element's texture.
 */
function gpuEffect(device, format, name) {
  const def = effects.get(name);
  if (!def?.wgsl) throw new Error(`effect "${name}" has no WGSL source`);
  let cache = gpuPipelines.get(device);
  if (!cache) gpuPipelines.set(device, (cache = new Map()));
  const key = `${name}|${format}`;
  let entry = cache.get(key);
  if (entry && entry.def === def) {
    if (entry.error) throw entry.error;
    return entry.pipeline;
  }
  const module = device.createShaderModule({ code: WGSL_HEAD + def.wgsl + WGSL_TAIL });
  const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
  entry = {
    def,
    error: null,
    pipeline: device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'fx_vs' },
      fragment: { module, entryPoint: 'fx_fs', targets: [{ format, blend: { color: over, alpha: over } }] },
    }),
  };
  // Compile errors arrive later. Remember them, so the next frame shows the element unshaded instead of nothing.
  entry.checked = (module.getCompilationInfo?.() ?? Promise.resolve({ messages: [] })).then(
    (info) => {
      const text = wgslErrors(info);
      if (text) entry.error = new Error(`WGSL compile failed: ${text}`);
      return entry.error;
    },
    () => null,
  );
  cache.set(key, entry);
  return entry.pipeline;
}

const WGSL_HEAD_LINES = WGSL_HEAD.split('\n').length - 1;
// Compile errors, with line numbers counted in the effect's own source (the shared header comes first in the module).
function wgslErrors(info) {
  return info.messages.filter((m) => m.type === 'error').map((m) => `line ${Math.max(1, m.lineNum - WGSL_HEAD_LINES)}: ${m.message}`).join('\n');
}

/**
 * Resolves to the compile error of an effect's WGSL on this device, or null.
 * A surface asks this when WebGPU rejects a frame: a typing mistake in a
 * custom effect is the effect's fault, not a reason to give up on WebGPU.
 */
function gpuEffectProblem(device, format, name) {
  return gpuPipelines.get(device)?.get(`${name}|${format}`)?.checked ?? Promise.resolve(null);
}

/** Compile an effect's WGSL (fn fx(p: vec2f) -> vec4f) without using it. Resolves to '' or the error text. */
async function checkEffectWGSL(device, wgsl) {
  try {
    return wgslErrors(await device.createShaderModule({ code: WGSL_HEAD + wgsl + WGSL_TAIL }).getCompilationInfo());
  } catch (err) {
    return err.message;
  }
}

/** The sampler effects use, one per device. */
function gpuSampler(device) {
  let cache = gpuPipelines.get(device);
  if (!cache) gpuPipelines.set(device, (cache = new Map()));
  if (!cache.sampler) cache.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  return cache.sampler;
}

// ---- built-in effects ------------------------------------------------------

defineEffect('none', {
  glsl: `vec4 fx(vec2 p) { return tex(p); }`,
  wgsl: `fn fx(p: vec2f) -> vec4f { return tex(p); }`,
});

/** perspective(d) rotateX rotateY about the element's centre, as a DOMMatrix. */
function tiltMatrix(width, height, rx, ry, distance = 900, scale = 1) {
  const persp = new DOMMatrix();
  persp.m34 = -1 / distance;
  return new DOMMatrix()
    .translate(width / 2, height / 2)
    .multiply(persp)
    .rotate(rx, ry, 0)
    .scale(scale)
    .translate(-width / 2, -height / 2);
}

defineEffect('tilt', {
  bleed: 28,
  // The element leans toward the pointer in perspective, with a moving sheen.
  // --fx-x / --fx-y (-1..1) lean it from CSS; --fx-amount scales the angle.
  geometry({ width, height, pointer, hover, amount, x, y }) {
    const max = 16 * amount;
    const px = pointer ? (pointer.x / width - 0.5) * 2 : 0;
    const py = pointer ? (pointer.y / height - 0.5) * 2 : 0;
    const ry = Math.max(-1.5, Math.min(1.5, px * hover + x)) * max;
    const rx = -Math.max(-1.5, Math.min(1.5, py * hover + y)) * max;
    if (!rx && !ry) return null;
    return tiltMatrix(width, height, rx, ry);
  },
  glsl: `vec4 fx(vec2 p) {
    vec2 s = unproject(p);
    // Smooth the silhouette: the edge of a tilted quad is not on pixel rows.
    float e = min(min(s.x, s.y), min(u_size.x - s.x, u_size.y - s.y));
    float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    vec4 col = tex(clamp(s, vec2(0.5), u_size - 0.5)) * cover;
    vec2 q = (s - u_pointer) / max(u_size.x, u_size.y);
    col.rgb += col.a * exp(-dot(q, q) * 9.0) * 0.14 * u_hover;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let s = unproject(p);
    let e = min(min(s.x, s.y), min(u.size.x - s.x, u.size.y - s.y));
    let cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    var col = tex(clamp(s, vec2f(0.5), u.size - 0.5)) * cover;
    let q = (s - u.pointer) / max(u.size.x, u.size.y);
    col = vec4f(col.rgb + col.a * exp(-dot(q, q) * 9.0) * 0.14 * u.hover, col.a);
    return col;
  }`,
});

// #region ripple
defineEffect('ripple', {
  // Rings spread from each click or tap and bend the element like water.
  glsl: `vec4 fx(vec2 p) {
    vec2 d = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 c = u_clicks[i];
      if (c.z < 0.0 || c.z > 2.4) continue;
      vec2 v = p - c.xy;
      float r = length(v), front = c.z * 380.0;
      float w = exp(-pow((r - front) / 34.0, 2.0)) * exp(-c.z * 1.7);
      d += normalize(v + 1e-4) * sin((r - front) * 0.2) * w * 13.0 * u_amount;
    }
    // A soft swell under the pointer.
    vec2 q = p - u_pointer;
    d += q * exp(-dot(q, q) / 2600.0) * 0.16 * u_hover * u_amount;
    vec4 col = tex(p - d);
    col.rgb += col.a * length(d) * 0.012;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    var d = vec2f(0.0);
    for (var i = 0; i < 4; i++) {
      let c = u.clicks[i];
      if (c.z < 0.0 || c.z > 2.4) { continue; }
      let v = p - c.xy;
      let r = length(v); let front = c.z * 380.0;
      let w = exp(-pow((r - front) / 34.0, 2.0)) * exp(-c.z * 1.7);
      d += normalize(v + 1e-4) * sin((r - front) * 0.2) * w * 13.0 * u.amount;
    }
    let q = p - u.pointer;
    d += q * exp(-dot(q, q) / 2600.0) * 0.16 * u.hover * u.amount;
    let col = tex(p - d);
    return vec4f(col.rgb + col.a * length(d) * 0.012, col.a);
  }`,
});
// #endregion ripple

defineEffect('glass', {
  // Liquid glass: the rim refracts what is inside it, with a little colour
  // fringing and a highlight, and a bead of magnification follows the pointer.
  glsl: `float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  vec4 fx(vec2 p) {
    vec2 c = u_size * 0.5;
    float rad = min(22.0, min(c.x, c.y));
    float d = -sdBox(p - c, c, rad);
    vec2 e = vec2(1.0, 0.0);
    vec2 n = normalize(vec2(sdBox(p - c + e.xy, c, rad) - sdBox(p - c - e.xy, c, rad), sdBox(p - c + e.yx, c, rad) - sdBox(p - c - e.yx, c, rad)) + 1e-5);
    float rim = 1.0 - smoothstep(0.0, min(26.0, min(c.x, c.y) * 0.8), d);
    float bend = rim * rim * 16.0 * u_amount;
    vec2 q = p - u_pointer;
    vec2 bead = -q * exp(-dot(q, q) / 3200.0) * 0.38 * u_hover * u_amount;
    vec2 s = p - n * bend + bead;
    vec4 col = tex(s);
    col.r = tex(s + n * bend * 0.18).r;
    col.b = tex(s - n * bend * 0.18).b;
    float light = dot(n, normalize(vec2(-0.5, -0.85)));
    col.rgb += col.a * pow(rim, 2.5) * (0.28 * max(light, 0.0) + 0.1 * max(-light, 0.0));
    col.rgb += col.a * exp(-dot(q, q) / 1500.0) * 0.07 * u_hover;
    return col;
  }`,
  wgsl: `fn sdBox(p: vec2f, b: vec2f, r: f32) -> f32 { let q = abs(p) - b + r; return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r; }
  fn fx(p: vec2f) -> vec4f {
    let c = u.size * 0.5;
    let rad = min(22.0, min(c.x, c.y));
    let d = -sdBox(p - c, c, rad);
    let e = vec2f(1.0, 0.0);
    let n = normalize(vec2f(sdBox(p - c + e.xy, c, rad) - sdBox(p - c - e.xy, c, rad), sdBox(p - c + e.yx, c, rad) - sdBox(p - c - e.yx, c, rad)) + 1e-5);
    let rim = 1.0 - smoothstep(0.0, min(26.0, min(c.x, c.y) * 0.8), d);
    let bend = rim * rim * 16.0 * u.amount;
    let q = p - u.pointer;
    let bead = -q * exp(-dot(q, q) / 3200.0) * 0.38 * u.hover * u.amount;
    let s = p - n * bend + bead;
    var col = tex(s);
    col.r = tex(s + n * bend * 0.18).r;
    col.b = tex(s - n * bend * 0.18).b;
    let light = dot(n, normalize(vec2f(-0.5, -0.85)));
    var rgb = col.rgb + col.a * pow(rim, 2.5) * (0.28 * max(light, 0.0) + 0.1 * max(-light, 0.0));
    rgb += col.a * exp(-dot(q, q) / 1500.0) * 0.07 * u.hover;
    return vec4f(rgb, col.a);
  }`,
});

defineEffect('haze', {
  animated: true,
  // Heat haze: rising noise bends the element, more at the top.
  glsl: `vec4 fx(vec2 p) {
    float t = u_time;
    vec2 q = p * 0.028 + vec2(0.0, t * 1.3);
    vec2 d = vec2(fbm(q) - 0.5, fbm(q + 31.7) - 0.5);
    float rise = mix(1.0, 0.45, clamp(p.y / u_size.y, 0.0, 1.0));
    vec4 col = tex(p + d * 9.0 * rise * u_amount);
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let q = p * 0.028 + vec2f(0.0, u.time * 1.3);
    let d = vec2f(fbm(q) - 0.5, fbm(q + 31.7) - 0.5);
    let rise = mix(1.0, 0.45, clamp(p.y / u.size.y, 0.0, 1.0));
    return tex(p + d * 9.0 * rise * u.amount);
  }`,
});

defineEffect('crt', {
  animated: true,
  // A tube: barrel curve, scanlines, an RGB mask, fringing, vignette, flicker.
  glsl: `vec4 fx(vec2 p) {
    vec2 uv = p / u_size * 2.0 - 1.0;
    float k = 0.06 * u_amount;
    vec2 w = uv * (1.0 + k * dot(uv.yx, uv.yx));
    vec2 s = (w * 0.5 + 0.5) * u_size;
    float split = 1.2 * u_amount;
    vec4 col = tex(s);
    col.r = tex(s + vec2(split, 0.0)).r;
    col.b = tex(s - vec2(split, 0.0)).b;
    float scan = 0.86 + 0.14 * sin(s.y * 3.14159 / 1.5);
    float mask = 0.94 + 0.06 * sin(s.x * 3.14159 / 1.0);
    float vig = smoothstep(1.7, 0.75, length(w));
    float flicker = 0.985 + 0.015 * sin(u_time * 50.0) + 0.02 * step(0.995, hash(vec2(floor(u_time * 30.0), 1.0)));
    float roll = 0.04 * smoothstep(0.0, 0.06, abs(fract(s.y / u_size.y - u_time * 0.12) - 0.5) - 0.44);
    col.rgb = col.rgb * 1.3 * scan * mask * vig * flicker + col.a * roll;
    col.rgb += col.a * vec3(0.0, 0.012, 0.004);
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let uv = p / u.size * 2.0 - 1.0;
    let k = 0.06 * u.amount;
    let w = uv * (1.0 + k * dot(uv.yx, uv.yx));
    let s = (w * 0.5 + 0.5) * u.size;
    let split = 1.2 * u.amount;
    var col = tex(s);
    col.r = tex(s + vec2f(split, 0.0)).r;
    col.b = tex(s - vec2f(split, 0.0)).b;
    let scan = 0.86 + 0.14 * sin(s.y * 3.14159 / 1.5);
    let mask = 0.94 + 0.06 * sin(s.x * 3.14159 / 1.0);
    let vig = 1.0 - smoothstep(0.75, 1.7, length(w));
    let flicker = 0.985 + 0.015 * sin(u.time * 50.0) + 0.02 * step(0.995, hash(vec2f(floor(u.time * 30.0), 1.0)));
    let roll = 0.04 * smoothstep(0.0, 0.06, abs(fract(s.y / u.size.y - u.time * 0.12) - 0.5) - 0.44);
    var rgb = col.rgb * 1.3 * scan * mask * vig * flicker + col.a * roll;
    rgb += col.a * vec3f(0.0, 0.012, 0.004);
    return vec4f(rgb, col.a);
  }`,
});

defineEffect('dissolve', {
  // Burns the element away as --fx-progress goes 0 → 1, with a glowing edge.
  glsl: `vec4 fx(vec2 p) {
    float n = fbm(p * 0.022) * 0.75 + 0.25 * (p.x / u_size.x);
    float cut = u_progress * 1.25 - 0.12;
    float d = n - cut;
    if (d < 0.0) return vec4(0.0);
    vec4 col = tex(p);
    float edge = 1.0 - smoothstep(0.0, 0.06, d);
    vec3 ember = mix(vec3(1.0, 0.85, 0.3), vec3(0.9, 0.2, 0.05), smoothstep(0.0, 0.05, d));
    col.rgb = mix(col.rgb, ember * col.a, edge * step(0.001, u_progress));
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let n = fbm(p * 0.022) * 0.75 + 0.25 * (p.x / u.size.x);
    let cut = u.progress * 1.25 - 0.12;
    let d = n - cut;
    let col = tex(p);
    if (d < 0.0) { return vec4f(0.0); }
    let edge = 1.0 - smoothstep(0.0, 0.06, d);
    let ember = mix(vec3f(1.0, 0.85, 0.3), vec3f(0.9, 0.2, 0.05), smoothstep(0.0, 0.05, d));
    return vec4f(mix(col.rgb, ember * col.a, edge * step(0.001, u.progress)), col.a);
  }`,
});

const CURL = {
  // Page curl from the bottom-right corner as --fx-progress goes 0 → 1.
  // The paper rolls round a cylinder and lies back over the page.
  glsl: `vec4 fx(vec2 p) {
    const float PI = 3.14159265;
    vec2 dir = normalize(vec2(-1.0, -0.62));
    float R = clamp(min(u_size.x, u_size.y) * 0.14, 12.0, 46.0);
    float L = dot(-u_size, dir);
    float D = u_progress * (L + PI * R + 4.0);
    float u = dot(p - u_size, dir);
    float d = u - D; // > 0: still flat. -R..0: under the roll. < -R: gone.
    if (u_progress <= 0.0) return tex(p);
    vec4 col = vec4(0.0);
    if (d >= 0.0) {
      col = tex(p);
      col.rgb *= 1.0 - 0.28 * exp(-d / (R * 0.9)); // shadow cast by the roll
      vec2 src = p + dir * ((D - PI * R - d) - u);  // paper lying back on top
      vec4 back = tex(src);
      if (back.a > 0.0) col = vec4(mix(back.rgb, vec3(back.a), 0.78) * 0.95, back.a);
    } else if (d > -R) {
      float s = -d / R;
      float a2 = R * (PI - asin(s));
      vec4 back = tex(p + dir * ((D - a2) - u));
      if (back.a > 0.0) {
        float shade = 0.72 + 0.28 * sqrt(1.0 - s * s);
        col = vec4(mix(back.rgb, vec3(back.a), 0.78) * shade, back.a);
      } else {
        vec4 front = tex(p + dir * ((D - R * asin(s)) - u));
        col = vec4(front.rgb * (1.0 - 0.45 * s), front.a);
      }
    }
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let PI = 3.14159265;
    let dir = normalize(vec2f(-1.0, -0.62));
    let R = clamp(min(u.size.x, u.size.y) * 0.14, 12.0, 46.0);
    let L = dot(-u.size, dir);
    let D = u.progress * (L + PI * R + 4.0);
    let along = dot(p - u.size, dir);
    let d = along - D;
    if (u.progress <= 0.0) { return tex(p); }
    var col = vec4f(0.0);
    if (d >= 0.0) {
      col = tex(p);
      col = vec4f(col.rgb * (1.0 - 0.28 * exp(-d / (R * 0.9))), col.a);
      let back = tex(p + dir * ((D - PI * R - d) - along));
      if (back.a > 0.0) { col = vec4f(mix(back.rgb, vec3f(back.a), 0.78) * 0.95, back.a); }
    } else if (d > -R) {
      let s = -d / R;
      let a2 = R * (PI - asin(s));
      let back = tex(p + dir * ((D - a2) - along));
      if (back.a > 0.0) {
        let shade = 0.72 + 0.28 * sqrt(1.0 - s * s);
        col = vec4f(mix(back.rgb, vec3f(back.a), 0.78) * shade, back.a);
      } else {
        let front = tex(p + dir * ((D - R * asin(s)) - along));
        col = vec4f(front.rgb * (1.0 - 0.45 * s), front.a);
      }
    }
    return col;
  }`,
};
defineEffect('curl', CURL);
defineEffect('page-curl', CURL);
return { effects, defineEffect, onEffectChange, resolveEffect, readParams, reducedMotion, effectTime, Interaction, inverseHomography, VERT, FRAG_HEAD, FRAG_TAIL, setupQuad, sharedGL, compileEffect, setEffectUniforms, WGSL_HEAD, WGSL_TAIL, WGSL_UNIFORM_SIZE, packWGSLUniforms, hasWGSL, gpuEffect, gpuEffectProblem, checkEffectWGSL, gpuSampler, tiltMatrix };
})();

// ---- public/lib/gpu-util.js ----
const m3 = (() => {
// WebGPU pieces shared by the elements in /lib/ that draw HTML through a
// shader. Which route a page uses (WebGPU, WebGL or 2D) is decided by
// /shared/backend.js; this file is what an element needs once the answer is
// WebGPU:
//
//   const gpu = await webgpu();                       // from /shared/backend.js
//   const surface = new GPUCanvas(canvas, gpu);       // the canvas, configured
//   const tex = new GPUElementTexture(gpu.device, canvas, element);
//   tex.update();                                     // element → GPUTexture
//   … one render pass into surface.view() …
//
// One device serves the whole page, so unlike WebGL (about 16 contexts a
// page) any number of elements can use it.

const Q = typeof GPUQueue !== 'undefined' ? GPUQueue.prototype : {};
/** The GPUQueue method this browser has for element → texture (the name has changed between Chromium versions). */
const gpuMethod = 'drawElementImageToTexture' in Q ? 'drawElementImageToTexture' : 'copyElementImageToTexture' in Q ? 'copyElementImageToTexture' : null;

/** True when this browser can put an element straight into a GPUTexture. */
const supportedGPU = typeof navigator !== 'undefined' && !!navigator.gpu && !!gpuMethod;

/** Put an element (or ElementImage) into a GPUTexture, whatever this build calls the method. */
function uploadElement(device, source, texture) {
  if (gpuMethod === 'drawElementImageToTexture') device.queue.drawElementImageToTexture({ source }, { texture });
  else device.queue.copyElementImageToTexture({ source }, { destination: { texture } });
}

/** Premultiplied "over" blending for a colour target. */
const BLEND_OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };

/** A GPUTexture kept the size of a drawable element's picture. Row 0 is the element's top. */
class GPUElementTexture {
  width = 0;
  height = 0;
  texture = null;
  view = null;
  constructor(device, canvas, element) {
    this.device = device;
    this.canvas = canvas;
    this.element = element;
  }
  /** Upload the element as it is drawn now. Throws "no cached paint record" until it has been painted once. */
  update() {
    const size = this.canvas.getElementImageDefaultSize(this.element);
    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    if (w !== this.width || h !== this.height) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.view = this.texture.createView();
      this.width = w;
      this.height = h;
    }
    uploadElement(this.device, this.element, this.texture);
  }
  destroy() {
    this.texture?.destroy();
    this.texture = this.view = null;
    this.width = this.height = 0;
  }
}

/**
 * A canvas drawn by the page's shared device. view() is where this frame
 * goes: the canvas, or with { present: false } a texture of the same size
 * that read() can copy out. Tests use that on machines whose WebGPU cannot
 * show a canvas (software adapters lose the device when they try).
 */
let probe = null;
/** True when a canvas has no visible pixel, read through a small copy (never getImageData() on the canvas itself). */
function looksBlank(canvas) {
  probe ??= new OffscreenCanvas(24, 24).getContext('2d', { willReadFrequently: true });
  probe.clearRect(0, 0, 24, 24);
  probe.drawImage(canvas, 0, 0, 24, 24);
  const d = probe.getImageData(0, 0, 24, 24).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}

/**
 * A guard for the first frames a WebGPU canvas shows. Call the returned
 * function right after each frame's submit(): it looks at the first two
 * frames, and if both show nothing it calls onBlank(reason) once, so the
 * element can fall back to WebGL instead of leaving an empty box. A self-test
 * and an error scope cannot see a frame that validates and still shows nothing.
 */
function blankWatch() {
  let frames = 0;
  let blank = 0;
  return (canvas, onBlank) => {
    if (frames >= 2) return;
    frames++;
    try {
      if (looksBlank(canvas)) blank++;
    } catch {
      frames = 2;
      return;
    }
    if (frames === 2 && blank === 2) queueMicrotask(() => onBlank('WebGPU showed an empty canvas'));
  };
}

class GPUCanvas {
  #target = null;
  #watch = blankWatch();
  /** Call after a frame's submit(). See blankWatch(). Does nothing for { present: false }. */
  shown(onBlank) {
    if (this.present) this.#watch(this.canvas, onBlank);
  }
  constructor(canvas, gpu, { present = true } = {}) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.device = gpu.device;
    this.format = gpu.format;
    this.present = present;
    // The canvas needs a WebGPU context for its children to be uploaded, even when nothing is shown on it.
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error('the canvas gave no WebGPU context');
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
  }
  get lost() {
    return !!this.gpu.lost;
  }
  view() {
    if (this.present) return this.context.getCurrentTexture().createView();
    const { width, height } = this.canvas;
    if (!this.#target || this.#target.width !== width || this.#target.height !== height) {
      this.#target?.destroy();
      this.#target = this.device.createTexture({ size: [width, height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    }
    return this.#target.createView();
  }
  /** The last frame as ImageData (premultiplied RGBA, top row first). Only with { present: false }. */
  async read() {
    const t = this.#target;
    if (!t) throw new Error('read() needs { present: false } and one drawn frame');
    const { device } = this;
    const { width, height } = t;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: t }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8ClampedArray(width * height * 4);
    const swap = this.format === 'bgra8unorm';
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
      if (!swap) out.set(row, y * width * 4);
      else for (let x = 0, o = y * width * 4; x < width * 4; x += 4, o += 4) { out[o] = row[x + 2]; out[o + 1] = row[x + 1]; out[o + 2] = row[x]; out[o + 3] = row[x + 3]; }
    }
    buffer.unmap();
    buffer.destroy();
    return new ImageData(out, width, height);
  }
  destroy() {
    this.#target?.destroy();
    this.#target = null;
    try {
      this.context.unconfigure();
    } catch {}
  }
}

/**
 * Run fn() (one frame's worth of WebGPU calls) now, and call onProblem with
 * the first validation error's first line if there was one. Elements wrap
 * their first frame in this, so a browser whose WebGPU rejects the element
 * upload falls back to WebGL with a reason instead of showing an empty box.
 * Anything fn() throws is thrown from here as usual.
 */
function watchFrame(device, fn, onProblem) {
  device.pushErrorScope('validation');
  try {
    return fn();
  } finally {
    device.popErrorScope().then(
      (error) => error?.message && onProblem(error.message.split('\n')[0]),
      () => {},
    );
  }
}

/** Compile WGSL and throw the errors with their lines, the way a GLSL compile does. */
async function checkWGSL(device, code, label = 'shader') {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(`${label} (WGSL): ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  return module;
}

/**
 * How far apart two pictures of the same thing are, for "WebGPU draws what
 * WebGL draws" checks. `straight` is ImageData read from a 2D canvas (straight
 * alpha), `premultiplied` is GPUCanvas.read(). Returns the mean and largest
 * difference per channel out of 255, and how much of the picture has ink.
 */
function pictureDifference(straight, premultiplied) {
  if (straight.width !== premultiplied.width || straight.height !== premultiplied.height) {
    throw new Error(`the pictures differ in size: ${straight.width}×${straight.height} against ${premultiplied.width}×${premultiplied.height}`);
  }
  const a = straight.data;
  const b = premultiplied.data;
  let sum = 0;
  let max = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i += 4) {
    const alpha = a[i + 3] / 255;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((c < 3 ? Math.round(a[i + c] * alpha) : a[i + 3]) - b[i + c]);
      sum += d;
      if (d > max) max = d;
    }
    if (b[i + 3] > 0) ink++;
  }
  return { mean: sum / a.length, max, ink: ink / (a.length / 4) };
}
return { gpuMethod, supportedGPU, uploadElement, BLEND_OVER, GPUElementTexture, looksBlank, blankWatch, GPUCanvas, watchFrame, checkWGSL, pictureDifference };
})();

// ---- public/shared/backend.js ----
const m4 = (() => {
// Which GPU route should a demo use: WebGPU, WebGL 2, or neither?
//
//   import { pickBackend, webgpu } from '/shared/backend.js';
//   const backend = await pickBackend();            // 'webgpu' | 'webgl' | '2d'
//   const { device, format } = await webgpu();      // or null, with webgpu.reason saying why
//
// WebGPU is only chosen when it is really usable, because a WebGPU device that
// dies takes every WebGL context and large 2D canvas on the page with it:
//
//   - there must be an adapter, and not a software (fallback) one. Headless
//     test browsers only have SwiftShader, where presenting to a canvas
//     destroys the device;
//   - a self-test draws one colour to a WebGPU canvas, copies it to a 2D
//     canvas with drawImage() and reads it back. That is the round trip the
//     demos rely on, so a browser that cannot do it is sent to WebGL.
//
// The device is shared: every caller on the page gets the same one.
// `webgpu({ force: true })` skips both rules (for tests that render to a
// texture and never present).

let attempt = null;
let forcedAttempt = null;

/** The page's shared WebGPU device, or null. Never throws. */
function webgpu({ force = false } = {}) {
  attempt ??= open(false);
  if (!force) return attempt;
  // A forced device is the page's own when that works, else one that skipped
  // the rules. It is never handed to a caller that did not ask for it: showing
  // a canvas with it could destroy it, and every WebGL context with it.
  forcedAttempt ??= attempt.then((gpu) => gpu ?? open(true));
  return forcedAttempt;
}
/** Why the page's device (the one webgpu() gives without force) is not usable. Empty when it is. */
webgpu.reason = '';

async function open(force) {
  const no = (reason) => {
    if (!force) webgpu.reason = reason;
    return null;
  };
  try {
    if (!navigator.gpu) return no('this browser has no WebGPU');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return no('WebGPU found no graphics adapter');
    const info = adapter.info ?? {};
    const software = info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? /swiftshader|llvmpipe|software/i.test(`${info.architecture} ${info.description}`);
    if (software && !force) return no('the only WebGPU adapter is a software one');
    const device = await adapter.requestDevice();
    const gpu = { device, adapter, format: navigator.gpu.getPreferredCanvasFormat(), lost: false, software: !!software };
    device.lost.then((e) => {
      gpu.lost = true;
      if (!force) webgpu.reason = `the WebGPU device was lost (${e.message || e.reason})`;
      dispatchEvent(new CustomEvent('webgpulost', { detail: e }));
    });
    if (!force) {
      const problem = await selfTest(gpu);
      if (problem) {
        device.destroy();
        return no(problem);
      }
    }
    if (!force) webgpu.reason = '';
    return gpu;
  } catch (err) {
    return no(`WebGPU failed to start (${err.message})`);
  }
}

// Clear a WebGPU canvas to a known colour and read it back through a 2D canvas.
async function selfTest({ device, format }) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('webgpu');
  if (!g) return 'no WebGPU canvas context';
  g.configure({ device, format, alphaMode: 'premultiplied' });
  const enc = device.createCommandEncoder();
  enc.beginRenderPass({ colorAttachments: [{ view: g.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 1, 0, 1] }] }).end();
  device.queue.submit([enc.finish()]);
  const t = document.createElement('canvas');
  t.width = t.height = 4;
  const t2 = t.getContext('2d', { willReadFrequently: true });
  t2.drawImage(c, 0, 0);
  const px = t2.getImageData(1, 1, 1, 1).data;
  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => setTimeout(r, 0));
  if (!(px[1] > 200 && px[0] < 60 && px[3] > 200)) return 'a WebGPU canvas could not be copied to a 2D canvas';
  return '';
}

/** True when a WebGL 2 context can be made. */
function webgl2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * The best route this browser can really run, from `order`.
 * `want` (an attribute or ?backend= value) wins when it is usable.
 */
async function pickBackend({ want = '', order = ['webgpu', 'webgl', '2d'] } = {}) {
  const usable = async (name) => (name === 'webgpu' ? !!(await webgpu()) : name === 'webgl' ? webgl2() : true);
  if (want && order.includes(want) && (await usable(want))) return want;
  for (const name of order) if (await usable(name)) return name;
  return '2d';
}
return { webgpu, webgl2, pickBackend };
})();

// ---- public/lib/shader-fx.js ----
const m0 = (() => {
// Shader CSS: run any element through a fragment shader with one attribute.
//
//   <script type="module" src="/lib/shader-fx.js"></script>
//
//   <button fx="ripple">Still a button</button>
//   <article fx="dissolve" style="--fx-progress: 0.4">…</article>
//
// Built-in effects: tilt, ripple, glass, haze, crt, dissolve, curl (page-curl).
// The same names work as <canvas-slot effect="…">; the registry, the shader
// contract and the CSS properties live in effects.js and are shared.
//
// CSS drives the shader. Two registered custom properties become uniforms, so
// transitions, animations, :hover and media queries all work:
//
//   --fx-progress   0..1   u_progress  (dissolve, curl)
//   --fx-amount     number u_amount    (strength, default 1)
//   --fx-x, --fx-y  number u_xy        (tilt direction, -1..1)
//
//   .card { transition: --fx-progress 600ms; }
//   .card:hover { --fx-progress: 1; }
//
// Your own effect is a GLSL function. `p` is in CSS pixels from the element's
// top-left, and tex(p) samples the element (premultiplied, clear outside):
//
//   import { defineEffect } from '/lib/shader-fx.js';
//   defineEffect('wobble', {
//     animated: true,
//     glsl: `vec4 fx(vec2 p) { return tex(p + vec2(sin(p.y * 0.1 + u_time * 4.0) * 4.0, 0.0)); }`,
//   });
//
// Uniforms: u_size (element size, px), u_time (s), u_pointer (px, far away when
// absent), u_hover (0..1, eased), u_progress, u_amount, u_xy, u_clicks[4] (x, y, age).
//
// fx can also point at a shader: fx="#script-id" or fx="url(/fx/wobble.frag)".
//
// How: the element is wrapped in <fx-surface>, which slots it into a canvas
// (see surface.js). Three backends:
//   webgpu  the canvas is WebGPU; queue.drawElementImageToTexture() uploads the
//           DOM into a GPUTexture and the effect's WGSL draws it. One device
//           for the whole page, so there is no limit on surfaces.
//   direct  the canvas is WebGL; texElementSubImage2D uploads the DOM straight
//           into a texture. A page only gets about 16 contexts.
//   shared  the canvas is 2D; the DOM is drawn with drawElementImage, copied
//           into ONE page-wide WebGL context, shaded, and drawn back. No limit.
// WebGPU is used when /shared/backend.js says it really works here and the
// effect has WGSL source (every built-in one does; your own needs a `wgsl`
// next to its `glsl`). Otherwise the first few surfaces go direct and the rest
// share. Force one with fx-backend="webgpu|direct|shared" on the element, or
// fx-backend="gl" for "WebGL either way, never WebGPU".
// surface.backend says which is in use and surface.gpuNote why WebGPU is not.
//
// The element stays where layout put it for hit testing: effects are visual.

const { SurfaceElement, ElementTexture, supported, supportedGL } = m1;
const { effects, defineEffect, onEffectChange, resolveEffect, readParams, reducedMotion, effectTime, inverseHomography, setupQuad, compileEffect, setEffectUniforms, sharedGL, hasWGSL, gpuEffect, gpuEffectProblem, gpuSampler, WGSL_UNIFORM_SIZE, packWGSLUniforms } = m2;
const { supportedGPU, GPUCanvas, GPUElementTexture, watchFrame } = m3;
const { webgpu } = m4;



const KINDS = ['webgpu', 'gl', 'direct', 'shared'];
const MAX_DIRECT = 8;
let liveDirect = 0;

const instances = new Set();
onEffectChange((name) => {
  for (const s of instances) if (s.rawEffect === name || s.effectName === name) s.effectChanged();
});

const shared = sharedGL;

// The page's WebGPU device, once /shared/backend.js has answered: { gpu } with
// gpu null when WebGPU is not usable. Surfaces made after that start at once.
let gpuAnswer = null;
let gpuBroken = ''; // set when WebGPU started but could not draw an element here
function askGPU(force = false) {
  return webgpu({ force }).then((gpu) => {
    if (!force) gpuAnswer = { gpu };
    return gpu;
  });
}
if (supportedGPU && supported) {
  askGPU();
  addEventListener('webgpulost', () => {
    for (const s of instances) if (s.backend === 'webgpu') s.leaveGPU(webgpu.reason || 'the WebGPU device was lost');
  });
}

class FxSurface extends SurfaceElement {
  static instances = instances;
  static defaultBleed = 0;
  static get supported() {
    return supported;
  }
  static get directContexts() {
    return liveDirect;
  }

  backend = null; // 'webgpu' | 'direct' | 'shared'
  /** Why this surface is not drawn by WebGPU ('' when it is, or was not asked yet). */
  gpuNote = '';
  #gpu = null; // GPUCanvas
  #gpuTex = null;
  #gpuUniforms = null;
  #gpuBind = null;
  #gpuChecked = false;
  #programs = new Map();
  #texture = null;
  #pointer = null;
  #hover = 0;
  #clicks = [];
  #visible = true;
  #io = null;
  #mo = null;
  #signature = '';
  #error = null;
  frames = 0;

  /** The element carrying the fx attribute (the surface itself if you wrote <fx-surface fx>). */
  get target() {
    return this.querySelector(':scope > [fx]') ?? this;
  }
  get rawEffect() {
    return (this.target.getAttribute('fx') || 'none').trim();
  }
  get effectName() {
    return resolveEffect(this.rawEffect, this.ownerDocument);
  }
  get error() {
    return this.#error;
  }

  get #want() {
    return this.target.getAttribute('fx-backend') ?? this.getAttribute('fx-backend');
  }
  // Tests on machines that cannot show a WebGPU canvas: draw to a texture and read it back.
  get #offscreen() {
    return this.hasAttribute('fx-offscreen') || this.target.hasAttribute('fx-offscreen');
  }

  createContext(canvas) {
    const want = this.#want;
    this.#wanted = KINDS.includes(want) ? want : null;
    this.#dropGPU();
    if (want === 'direct' || want === 'shared' || want === 'gl') {
      this.gpuNote = `fx-backend="${want}" was asked for`;
      return this.#contextGL(canvas, want === 'gl' ? null : want);
    }
    if (!supportedGPU) {
      this.gpuNote = 'this browser cannot put an element into a WebGPU texture';
      return this.#contextGL(canvas, null);
    }
    if (gpuBroken) {
      this.gpuNote = gpuBroken;
      return this.#contextGL(canvas, null);
    }
    const start = (gpu) => {
      this.#noWGSL = false;
      if (!gpu || gpu.lost) this.gpuNote = webgpu.reason || 'WebGPU did not start';
      else if (want !== 'webgpu' && !hasWGSL(this.effectName)) {
        this.gpuNote = `the effect "${this.rawEffect}" has no WGSL source`;
        this.#noWGSL = true;
      } else {
        try {
          this.#gpu = new GPUCanvas(canvas, gpu, { present: !this.#offscreen });
          this.backend = 'webgpu';
          this.gpuNote = '';
          this.#gpuChecked = false;
          return this.#gpu.context;
        } catch (err) {
          this.gpuNote = err.message;
        }
      }
      return this.#contextGL(canvas, null);
    };
    const force = this.#offscreen;
    if (gpuAnswer && !force) return start(gpuAnswer.gpu);
    return askGPU(force).then(start);
  }

  #dropGPU() {
    this.#gpuTex?.destroy();
    this.#gpu?.destroy();
    this.#gpu = this.#gpuTex = this.#gpuUniforms = this.#gpuBind = null;
  }

  /** Stop using WebGPU on this surface and start again on WebGL (called when the device is lost or rejects a frame). */
  leaveGPU(reason) {
    if (this.backend !== 'webgpu') return;
    this.#dropGPU();
    this.backend = null;
    gpuBroken ||= reason;
    this.dispatchEvent(new CustomEvent('fxfallback', { detail: { from: 'webgpu', reason }, bubbles: true }));
    this.swapCanvas();
  }

  #contextGL(canvas, want) {
    const direct = want ? want === 'direct' : supportedGL && liveDirect < MAX_DIRECT;
    if (direct && supportedGL) {
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
      if (gl) {
        this.backend = 'direct';
        liveDirect++;
        setupQuad(gl);
        this.#programs = new Map();
        this.#texture = null;
        canvas.addEventListener('webglcontextlost', (e) => {
          if (canvas !== this.canvas) return;
          e.preventDefault();
          this.#programs = new Map();
          this.#texture = null;
          this.#lost = setTimeout(() => canvas === this.canvas && this.fallBackToPlain('WebGL context lost'), 1500);
        });
        canvas.addEventListener('webglcontextrestored', () => {
          clearTimeout(this.#lost);
          if (canvas !== this.canvas) return;
          setupQuad(gl);
          this.contentDirty = true;
          this.invalidate();
        });
        return gl;
      }
    }
    this.backend = 'shared';
    return canvas.getContext('2d');
  }
  #lost = 0;
  #forced = false;

  connected() {
    FxSurface.instances.add(this);
    queueMicrotask(() => this.#syncBleed()); // after adopt() has marked the surface as adopted
    this.addEventListener('pointermove', this.#onMove);
    this.addEventListener('pointerleave', this.#onLeave);
    this.addEventListener('pointerdown', this.#onDown);
    this.#io = new IntersectionObserver(([entry]) => {
      this.#visible = entry.isIntersecting;
      if (this.#visible) this.invalidate();
    }, { rootMargin: '100px' });
    this.#io.observe(this);
    // If the author takes the fx attribute off, hand the element back.
    this.#mo = new MutationObserver(() => {
      if (this.adopted && !this.querySelector(':scope > [fx]')) FxSurface.release(this);
      else this.effectChanged();
    });
    this.#mo.observe(this, { attributes: true, subtree: true, attributeFilter: ['fx', 'fx-backend', 'style', 'class'] });
  }

  disconnected() {
    FxSurface.instances.delete(this);
    this.#io?.disconnect();
    this.#mo?.disconnect();
    if (this.backend === 'webgpu') {
      this.#dropGPU();
      this.ctx = null;
      this.backend = null;
    }
    if (this.backend === 'direct' && this.ctx) {
      liveDirect = Math.max(0, liveDirect - 1);
      this.ctx.getExtension('WEBGL_lose_context')?.loseContext();
      this.ctx = null;
      this.backend = null;
    }
  }

  effectChanged() {
    this.#signature = '';
    this.#error = null;
    this.#syncBleed();
    // The backend attribute may have changed too: a different kind of context needs a different canvas.
    const want = this.#want;
    const kind = KINDS.includes(want) ? want : null;
    if (this.backend && kind !== this.#wanted) return this.#restart();
    // On WebGL only for want of WGSL, and the effect now has some: try WebGPU again.
    if (this.backend && this.#noWGSL && hasWGSL(this.effectName)) return this.#restart();
    this.invalidate();
  }
  #wanted = null;
  #noWGSL = false;

  // The effect may have been defined, or swapped, after the element was
  // wrapped: give the canvas the room around the element that it asks for.
  #syncBleed() {
    if (!this.adopted || !this.live || this.target.hasAttribute('fx-bleed')) return;
    const bleed = effects.get(this.effectName)?.bleed ?? 0;
    if (bleed === this.bleed) return;
    this.bleed = bleed;
    this.setAttribute('bleed', bleed);
    this.canvas.style.setProperty('--surface-bleed', bleed + 'px');
    this.contentDirty = true;
  }

  #restart() {
    if (this.backend === 'direct') {
      liveDirect = Math.max(0, liveDirect - 1);
      this.ctx?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.#dropGPU();
    this.backend = null;
    this.swapCanvas();
  }

  #onMove = (e) => {
    this.#pointer = this.localPoint(e);
    this.invalidate();
  };
  #onLeave = () => {
    this.#pointer = null;
    this.invalidate();
  };
  #onDown = (e) => {
    const p = this.localPoint(e);
    this.#clicks.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.#clicks.length > 4) this.#clicks.shift();
    this.#pointer = p;
    this.invalidate();
  };

  /** Render now and return the canvas pixels (the WebGL buffer is not kept between frames). */
  snapshot() {
    this.#signature = '';
    this.contentDirty = true;
    this.#forced = true;
    try {
      this.render(performance.now());
    } finally {
      this.#forced = false;
    }
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.canvas, 0, 0);
    return ctx;
  }

  /** Start a ripple from script (element px). */
  poke(x, y) {
    this.#clicks.push({ x, y, t: performance.now() });
    if (this.#clicks.length > 4) this.#clicks.shift();
    this.invalidate();
  }

  render(now) {
    if (!this.#visible && !this.#forced) return false;
    const name = this.effectName;
    const def = effects.get(name);
    const { progress, amount, x, y } = readParams(this.target);
    const still = reducedMotion.matches;

    // Ease hover; age clicks.
    const hoverTarget = this.#pointer ? 1 : 0;
    this.#hover += (hoverTarget - this.#hover) * (still ? 1 : 0.18);
    if (Math.abs(hoverTarget - this.#hover) < 0.004) this.#hover = hoverTarget;
    const t = performance.now();
    this.#clicks = this.#clicks.filter((c) => t - c.t < 2600);
    const clicks = new Float32Array(16).fill(-1);
    this.#clicks.forEach((c, i) => clicks.set([c.x, c.y, still ? -1 : (t - c.t) / 1000, 0], i * 4));

    const moving = (def.animated && !still) || this.#clicks.length > 0 || this.#hover !== hoverTarget;
    const time = effectTime();
    const p = this.#pointer ?? { x: -1e4, y: -1e4 };
    const signature = `${name}|${progress}|${amount}|${x},${y}|${p.x},${p.y}|${this.#hover}|${this.canvas.width}x${this.canvas.height}|${moving ? time : ''}`;
    // CSS can change --fx-progress at any time (a transition, :hover), and
    // there is no event for that, so keep sampling while on screen and only
    // draw when a uniform actually changed.
    if (signature === this.#signature && !this.contentDirty) return true;
    this.#signature = signature;

    // An effect that moves the element (tilt) says where, so hit testing follows.
    const matrix = def.geometry?.({ width: this.width, height: this.height, pointer: this.#pointer, hover: this.#hover, progress, amount, x, y }) ?? null;
    const uniforms = { progress, amount, time, pointer: p, clicks, x, y, inv: inverseHomography(matrix) };
    if (this.backend === 'webgpu' && !hasWGSL(name) && this.#want !== 'webgpu') {
      // Only GLSL for this effect: this surface moves to WebGL, the others stay.
      this.gpuNote = `the effect "${this.rawEffect}" has no WGSL source`;
      this.#restart();
      return false;
    }
    const draw = (n) => (this.backend === 'webgpu' ? this.#renderGPU(n, uniforms) : this.backend === 'direct' ? this.#renderDirect(n, uniforms) : this.#renderShared(n, uniforms));
    try {
      draw(name);
      this.#error = null;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) throw err;
      // A broken custom shader should not hide the element: show it unshaded.
      if (!this.#error) console.warn(`fx="${name}": ${err.message}`);
      this.#error = err;
      if (name !== 'none') {
        try {
          draw('none');
        } catch {}
      }
    }
    this.setGeometry(matrix ? this.restMatrix.multiply(matrix) : undefined);
    this.contentDirty = false;
    this.frames++;
    return true;
  }

  #setUniforms(gl, u, uniforms, texOrigin, texSize) {
    setEffectUniforms(gl, u, {
      ...uniforms,
      canvas: [this.canvas.width / this.scale, this.canvas.height / this.scale],
      origin: [this.bleed, this.bleed],
      texOrigin,
      texSize,
      size: [this.width, this.height],
      hover: this.#hover,
    });
  }

  // DOM → GPUTexture → the effect's WGSL, on the page's shared device.
  #renderGPU(name, uniforms) {
    const g = this.#gpu;
    if (!g || g.lost) return;
    const { device } = g;
    const frame = () => {
      this.#gpuTex ??= new GPUElementTexture(device, this.canvas, this.content);
      if (this.contentDirty || !this.#gpuTex.width) this.#gpuTex.update();
      const pipeline = gpuEffect(device, g.format, name);
      this.#gpuUniforms ??= device.createBuffer({ size: WGSL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const s = this.scale;
      device.queue.writeBuffer(this.#gpuUniforms, 0, packWGSLUniforms({
        ...uniforms,
        canvas: [this.canvas.width / s, this.canvas.height / s],
        origin: [this.bleed, this.bleed],
        texSize: [this.#gpuTex.width / s, this.#gpuTex.height / s],
        size: [this.width, this.height],
        hover: this.#hover,
      }, s));
      if (!this.#gpuBind || this.#gpuBind.pipeline !== pipeline || this.#gpuBind.view !== this.#gpuTex.view) {
        this.#gpuBind = {
          pipeline,
          view: this.#gpuTex.view,
          group: device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.#gpuUniforms } }, { binding: 1, resource: gpuSampler(device) }, { binding: 2, resource: this.#gpuTex.view }],
          }),
        };
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: g.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.#gpuBind.group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      g.shown((why) => this.#gpu === g && this.leaveGPU(why));
    };
    if (this.#gpuChecked) return frame();
    // The first frame is watched: a browser whose WebGPU rejects the element upload goes to WebGL, with the reason.
    watchFrame(device, frame, async (problem) => {
      // An effect whose WGSL does not compile fails this frame too. That is the effect's error, shown unshaded; WebGPU itself is fine.
      const broken = await gpuEffectProblem(device, g.format, name);
      if (this.#gpu !== g) return;
      if (!broken) return this.leaveGPU(`WebGPU rejected the first frame: ${problem}`);
      this.#gpuChecked = false;
      this.#signature = '';
      this.invalidate();
    });
    this.#gpuChecked = true;
  }

  /** The last frame as ImageData. Needs fx-offscreen on a WebGPU surface; other backends copy the canvas. */
  async readback() {
    if (this.backend === 'webgpu' && this.#gpu && !this.#gpu.present) {
      this.#signature = '';
      this.contentDirty = true;
      this.#forced = true;
      try {
        this.render(performance.now());
      } finally {
        this.#forced = false;
      }
      return this.#gpu.read();
    }
    const ctx = this.snapshot();
    return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // #region render
  // DOM → texture on this canvas's own WebGL context.
  #renderDirect(name, uniforms) {
    const gl = this.ctx;
    if (gl.isContextLost()) return;
    const { program: prog, u } = compileEffect(gl, this.#programs, name);
    this.#texture ??= new ElementTexture(gl, this.canvas, this.content);
    gl.activeTexture(gl.TEXTURE0);
    if (this.contentDirty || !this.#texture.width) this.#texture.update();
    else gl.bindTexture(gl.TEXTURE_2D, this.#texture.texture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog);
    this.#setUniforms(gl, u, uniforms, [0, 0], [this.#texture.width / this.scale, this.#texture.height / this.scale]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // #endregion render

  // DOM → this 2D canvas → the shared WebGL context → back to this canvas.
  #renderShared(name, uniforms) {
    const ctx = this.ctx;
    const { width: cw, height: ch } = this.canvas;
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, cw / s, ch / s);
    ctx.drawElementImage(this.content, this.bleed, this.bleed, this.width, this.height);
    const gl = shared.ensure();
    if (!gl) return; // no WebGL at all: the plain drawing stays
    if (shared.canvas.width < cw) shared.canvas.width = cw;
    if (shared.canvas.height < ch) shared.canvas.height = ch;
    const { program: prog, u } = compileEffect(gl, shared.programs, name);
    shared.upload(this.canvas);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog);
    this.#setUniforms(gl, u, uniforms, [this.bleed, this.bleed], [cw / s, ch / s]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(shared.canvas, 0, shared.canvas.height - ch, cw, ch, 0, 0, cw, ch);
  }
}

// Two copies of this library on one page (say /lib/fx.js and /lib/shader-fx.js)
// would both try to wrap every [fx] element. The first one to load does the work.
const firstCopy = !customElements.get('fx-surface');
if (firstCopy) customElements.define('fx-surface', FxSurface);
else console.warn('fx: the library is already loaded on this page. This second copy does nothing, and effects defined through it are not used.');

// ---- the attribute: wrap anything that says fx="…" ----------------------

function adopt(el) {
  if (!(el instanceof HTMLElement) || el instanceof FxSurface) return;
  if (el.parentElement instanceof FxSurface) return;
  if (!supported) return; // plain HTML: leave the page alone
  const name = resolveEffect(el.getAttribute('fx'), el.ownerDocument);
  const bleed = el.getAttribute('fx-bleed') ?? effects.get(name)?.bleed ?? 0;
  // The host connects before the element is moved into it, so anything the
  // context choice depends on has to be on the host already.
  const attrs = { bleed };
  if (el.hasAttribute('fx-backend')) attrs['fx-backend'] = el.getAttribute('fx-backend');
  if (el.hasAttribute('fx-offscreen')) attrs['fx-offscreen'] = '';
  const host = FxSurface.adopt(el, attrs);
  host.adopted = true;
}

function scan(root) {
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1 && root.hasAttribute('fx')) adopt(root);
  for (const el of root.querySelectorAll('[fx]')) adopt(el);
}

if (typeof document !== 'undefined' && firstCopy) {
  const start = () => {
    scan(document);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if (r.target.hasAttribute('fx')) adopt(r.target);
        } else for (const n of r.addedNodes) scan(n);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['fx'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
return { effects, defineEffect, FxSurface };
})();

export const { defineEffect, effects, FxSurface } = m0;
