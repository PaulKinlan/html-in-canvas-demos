// <canvas-slot>: reproject light-DOM children into an HTML-in-canvas canvas
// via shadow DOM slots.
//
// Usage:
//   <canvas-slot>
//     <h2 slot="title">Hello</h2>
//     <p slot="body">Real, selectable, accessible DOM…</p>
//   </canvas-slot>
//
//   el.onrender = ({ ctx, width, height, elements, draw, time }) => { … };
//
// The author's markup stays where it is in the document. The custom element's
// shadow root holds the <canvas content="drawable"> and one <slot name=…> per
// slot name it sees, so the light-DOM children are laid out (flat tree) as
// canvas descendants and can be passed to drawElementImage().
//
// Worker mode: <canvas-slot worker="./my-worker.js"> transfers the canvas to
// an OffscreenCanvas in that worker and, on every paint, sends it the changed
// elements as transferable ElementImage snapshots. See /offscreen/.
//
// Effects: <canvas-slot effect="tilt"> needs no onrender at all. Each slot
// becomes a WebGL texture and is drawn through the named fragment shader
// (tilt, ripple, dissolve, page-curl, glass, haze, crt, or your own), driven
// by CSS custom properties. effect="#script-id" or effect="url(x.frag)" points
// at a shader; backend="webgpu" uses WGSL. See slot-effects.js and
// /slot-effects/. That file is only loaded when the attribute is used.

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

export class CanvasSlot extends HTMLElement {
  #root;
  #canvas;
  #ctx = null;
  #worker = null;
  #slots = new Map();
  #sent = new WeakSet();
  #raf = 0;
  #dpr = devicePixelRatio;
  onrender = null;
  #fx = null; // the shader renderer from slot-effects.js, when effect="…" is set
  #mode = null; // '2d' | 'worker' | 'webgl' | 'shared' | 'webgpu'
  #avoid = new Set(); // backends that failed here
  #loading = 0;
  #tries = new Map();
  #backendAttr = null;

  static observedAttributes = ['effect', 'backend'];

  static get supported() {
    return SUPPORTED;
  }

  /** The shader renderer while an effect is active (frames, error, kind, pixel(), poke()), else null. */
  get effects() {
    return this.#fx;
  }

  /**
   * How this element is drawing: '2d', 'worker', 'webgl' (its own context),
   * 'shared' (a 2D canvas borrowing the page's shared WebGL context) or 'webgpu'.
   */
  get mode() {
    return this.#fx?.kind ?? this.#mode;
  }

  attributeChangedCallback() {
    if (!this.isConnected || !this.#mode || this.#mode === 'worker') return;
    if (this.#wantedMode() !== this.#mode || this.#backendAttr !== this.getAttribute('backend')) this.#start(true);
    else this.#fx?.changed();
  }

  #wantedMode() {
    if (!this.hasAttribute('effect')) return '2d';
    const gl = typeof WebGL2RenderingContext !== 'undefined' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype;
    const gpu = typeof GPUQueue !== 'undefined' && 'drawElementImageToTexture' in GPUQueue.prototype;
    const want = this.getAttribute('backend');
    if (want === 'webgpu' && gpu && !this.#avoid.has('webgpu')) return 'webgpu';
    if (gl && want !== 'shared' && !this.#avoid.has('webgl')) return 'webgl';
    return SUPPORTED && typeof WebGL2RenderingContext !== 'undefined' && !this.#avoid.has('shared') ? 'shared' : '2d';
  }

  // A canvas keeps the first kind of context it is given, so changing between
  // 2D, WebGL and WebGPU means a new canvas. The slots move across.
  #freshCanvas() {
    const old = this.#canvas;
    const canvas = old.cloneNode(false);
    canvas.append(...old.childNodes);
    this.#ro?.unobserve(old);
    old.replaceWith(canvas);
    this.#canvas = canvas;
    this.#observeSize();
    canvas.addEventListener('paint', this.#paint);
    canvas.addEventListener('contextrestored', () => this.requestPaint());
  }

  #start(replace = false) {
    this.#fx?.destroy();
    this.#fx = null;
    this.#ctx = null;
    if (replace) this.#freshCanvas();
    const mode = (this.#mode = this.#wantedMode());
    this.#backendAttr = this.getAttribute('backend');
    if (mode === '2d') {
      this.#ctx = this.#canvas.getContext('2d');
      this.requestPaint();
      return;
    }
    const token = ++this.#loading;
    import('./slot-effects.js').then((m) => {
      if (token !== this.#loading || !this.isConnected) return;
      try {
        this.#fx = m.attach(this, this.#canvas, mode, (reason) => this.#fallBack(mode, reason), { present: !this.hasAttribute('offscreen'), force: this.getAttribute('backend') === 'webgl' });
      } catch (err) {
        this.#fallBack(mode, err.message);
      }
      this.requestPaint();
    });
  }

  // A lost context gets one fresh canvas of the same kind before that kind is
  // given up on; a kind that cannot start at all is dropped at once.
  #fallBack(mode, reason) {
    if (this.#mode !== mode) return;
    const tries = (this.#tries.get(mode) ?? 0) + 1;
    this.#tries.set(mode, tries);
    const retry = /lost/i.test(reason) && mode !== 'webgpu' && tries <= 2;
    if (!retry) {
      console.warn(`<canvas-slot effect>: ${mode} failed (${reason}); falling back`);
      this.#avoid.add(mode);
    }
    this.dispatchEvent(new CustomEvent('effectfallback', { detail: { from: mode, reason } }));
    this.#start(true);
  }

  #paint = (e) => this.#onPaint(e);

  #observeSize() {
    try {
      this.#ro.observe(this.#canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#ro.observe(this.#canvas);
    }
  }

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `
      <style>
        :host { display: block; position: relative; contain: layout; }
        canvas { display: block; width: 100%; height: 100%; }
        /* No HTML-in-canvas: the slots sit outside the canvas, so the
           content is ordinary HTML instead of hidden fallback content. */
        :host([plain]) { height: auto !important; }
        :host([plain]) canvas { display: none; }
        /* Slots are display: contents, so slotted elements become the
           canvas's layout children. */
      </style>
      <canvas part="canvas" content="drawable" layoutsubtree></canvas>`;
    this.#canvas = this.#root.querySelector('canvas');
  }

  get canvas() {
    return this.#canvas;
  }

  /** Map of slot name -> the light-DOM element currently assigned to it. */
  get elements() {
    const map = new Map();
    for (const [name, slot] of this.#slots) {
      const [el] = slot.assignedElements();
      if (el) map.set(name, el);
    }
    return map;
  }

  connectedCallback() {
    this.#syncSlots();
    this.#mo = new MutationObserver(() => this.#syncSlots());
    this.#mo.observe(this, { childList: true, attributes: true, attributeFilter: ['slot'], subtree: false });
    this.#ro = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      const w = box ? box.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio);
      const h = box ? box.blockSize : Math.round(entry.contentRect.height * devicePixelRatio);
      this.#dpr = w / Math.max(1, entry.contentRect.width);
      if (this.#worker) {
        this.#worker.postMessage({ type: 'resize', width: w, height: h, dpr: this.#dpr });
      } else {
        this.#canvas.width = w;
        this.#canvas.height = h;
      }
      this.requestPaint();
    });
    this.#observeSize();

    if (!SUPPORTED) {
      this.toggleAttribute('plain', true);
      return;
    }

    const workerUrl = this.getAttribute('worker');
    if (workerUrl) {
      this.#worker = new Worker(new URL(workerUrl, document.baseURI), { type: 'module' });
      this.#worker.onmessage = (e) => this.dispatchEvent(new CustomEvent('workermessage', { detail: e.data }));
      const offscreen = this.#canvas.transferControlToOffscreen();
      this.#worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
      this.#mode = 'worker';
    } else {
      // A canvas that already has a context (the element was moved in the
      // document) cannot take another kind, so start from a new one.
      this.#start(this.#mode !== null);
    }
    this.#canvas.addEventListener('paint', this.#paint);
  }

  #mo;
  #ro;

  disconnectedCallback() {
    this.#mo?.disconnect();
    this.#ro?.disconnect();
    cancelAnimationFrame(this.#raf);
    this.#worker?.terminate();
    this.#worker = null;
    this.#fx?.destroy();
    this.#fx = null;
    this.#loading++;
  }

  /** Post an arbitrary message to the worker (worker mode only). */
  postToWorker(message, transfer = []) {
    this.#worker?.postMessage(message, transfer);
  }

  requestPaint() {
    if (SUPPORTED) this.#canvas.requestPaint();
  }

  /** Keep firing paint every frame (for animated renderers). */
  set animate(on) {
    cancelAnimationFrame(this.#raf);
    if (!on) return;
    const tick = () => {
      this.requestPaint();
      this.#raf = requestAnimationFrame(tick);
    };
    tick();
  }

  #syncSlots() {
    const names = new Set();
    for (const child of this.children) {
      const name = child.getAttribute('slot');
      if (!name) continue;
      names.add(name);
      // Every slotted element must opt in to being drawn.
      if (!child.hasAttribute('drawable')) child.setAttribute('drawable', '');
    }
    for (const name of names) {
      if (this.#slots.has(name)) continue;
      const slot = document.createElement('slot');
      slot.name = name;
      slot.addEventListener('slotchange', () => this.requestPaint());
      (SUPPORTED ? this.#canvas : this.#root).append(slot);
      this.#slots.set(name, slot);
    }
    for (const [name, slot] of this.#slots) {
      if (!names.has(name)) {
        slot.remove();
        this.#slots.delete(name);
      }
    }
    this.requestPaint();
  }

  #onPaint(event) {
    const elements = this.elements;
    if (this.#worker) {
      // Capture snapshots for changed elements (or all of them the first time)
      // and transfer them to the worker that owns the OffscreenCanvas.
      const changed = new Set(event.changedElements ?? []);
      const images = {};
      const sizes = {};
      const transfer = [];
      for (const [name, el] of elements) {
        sizes[name] = { width: el.offsetWidth, height: el.offsetHeight };
        if (this.#sent.has(el) && !changed.has(el)) continue;
        try {
          const img = this.#canvas.captureElementImage(el);
          images[name] = img;
          transfer.push(img);
          this.#sent.add(el);
        } catch (err) {
          // Not painted yet; we'll get another paint event.
        }
      }
      this.#worker.postMessage({ type: 'paint', images, sizes, time: performance.now() }, transfer);
      return;
    }

    if (this.#fx) {
      // Shader mode: same renderer contract, but draw() shades each slot.
      this.#fx.paint({ elements, renderer: this.onrender ?? defaultRenderer, event, dpr: this.#dpr });
      this.dispatchEvent(new CustomEvent('render', { detail: { elements, changed: new Set(event.changedElements ?? []), dpr: this.#dpr } }));
      return;
    }
    const ctx = this.#ctx;
    if (!ctx) return; // the effect renderer is still loading
    const dpr = this.#dpr;
    const width = this.#canvas.width / dpr;
    const height = this.#canvas.height / dpr;
    ctx.reset();
    ctx.scale(dpr, dpr);
    const draw = (name, x = 0, y = 0, w, h) => {
      const el = typeof name === 'string' ? elements.get(name) : name;
      if (!el) return;
      ctx.drawElementImage(el, x, y, w ?? el.offsetWidth, h ?? el.offsetHeight);
    };
    const renderer = this.onrender ?? defaultRenderer;
    renderer({ ctx, canvas: this.#canvas, width, height, dpr, elements, draw, time: performance.now(), event });
    // Let others (e.g. slot-share.js) react to a finished frame.
    this.dispatchEvent(new CustomEvent('render', { detail: { elements, changed: new Set(event.changedElements ?? []), dpr } }));
  }
}

function defaultRenderer({ width, elements, draw }) {
  let y = 0;
  for (const [, el] of elements) {
    draw(el, (width - el.offsetWidth) / 2, y);
    y += el.offsetHeight + 8;
  }
}

if (!customElements.get('canvas-slot')) customElements.define('canvas-slot', CanvasSlot);
