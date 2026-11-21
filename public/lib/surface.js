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

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

export const supportedGL =
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

export class SurfaceElement extends HTMLElement {
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
    // A WebGL canvas fires its own event. A subclass that handles the loss
    // moves to a new canvas or gets the context restored within the wait.
    canvas.addEventListener('webglcontextlost', () => {
      if (canvas !== this.canvas) return;
      lost = setTimeout(() => canvas === this.canvas && this.ctx?.isContextLost?.() && this.fallBackToPlain('WebGL context lost'), 1500);
    });
    canvas.addEventListener('webglcontextrestored', () => clearTimeout(lost));
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
export function cssZoom(element) {
  return element.currentCSSZoom || 1;
}

/**
 * updateElementGeometry()'s canvasTransform has been seen to work in CSS pixels
 * on some canvases and in canvas-buffer pixels on others, which only shows up
 * when the two differ (any high-DPI screen). Rather than guess, measure: apply
 * the identity, see how wide the element says it is, and return the factor
 * that makes one unit one CSS pixel. Cached until the canvas changes size.
 */
export function geometryUnit(canvas, element, cssWidth) {
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
export function program(gl, vertexSrc, fragmentSrc) {
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
export class ElementTexture {
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
