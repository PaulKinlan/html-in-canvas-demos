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
// Content from elsewhere: a slot only takes children of this element, so
// <canvas-slot from="#promo, .card"> (or el.adopt(node)) moves the matching
// elements in for you and el.release(node) puts them back exactly where they
// were. They are the same nodes, not copies. See /slot/#outside.
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

  static observedAttributes = ['effect', 'backend', 'from'];
  #retries = 0;
  #retryTimer = 0;
  #adopted = new Map(); // element -> { marker, slot, drawable, viaFrom }

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

  attributeChangedCallback(name) {
    if (name === 'from') {
      if (this.isConnected) this.#syncFrom();
      return;
    }
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
    if (this.hasAttribute('from')) this.#syncFrom();
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
        // Assigning either side clears the canvas, even to the same value.
        if (this.#canvas.width !== w) this.#canvas.width = w;
        if (this.#canvas.height !== h) this.#canvas.height = h;
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
      // #region worker
      this.#worker = new Worker(new URL(workerUrl, document.baseURI), { type: 'module' });
      this.#worker.onmessage = (e) => this.dispatchEvent(new CustomEvent('workermessage', { detail: e.data }));
      const offscreen = this.#canvas.transferControlToOffscreen();
      this.#worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
      // #endregion worker
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
    clearTimeout(this.#retryTimer);
    this.#worker?.terminate();
    this.#worker = null;
    this.#fx?.destroy();
    this.#fx = null;
    this.#loading++;
  }

  /**
   * Bring an element that lives anywhere in the document into this canvas.
   * A slot can only take children of its host, so the element is moved here
   * (the same node, with its listeners and state) and a marker is left where
   * it was. It keeps its slot="…" name if it has one, else `slot`, else its id.
   * Because it has a new parent, CSS that matched it through its old
   * ancestors (".sidebar > .card") stops matching; style it by class or id.
   */
  adopt(el, slot) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el || el === this || el.contains(this)) return null;
    if (el.parentNode === this && !this.#adopted.has(el)) {
      if (slot) el.setAttribute('slot', slot);
      return el;
    }
    let rec = this.#adopted.get(el);
    if (!rec) {
      const marker = document.createComment(' canvas-slot: an element was moved from here ');
      el.before(marker);
      rec = { marker, slot: el.getAttribute('slot'), drawable: el.hasAttribute('drawable'), viaFrom: false };
      this.#adopted.set(el, rec);
    }
    const name = slot || el.getAttribute('slot') || el.id || `adopted-${this.#adopted.size}`;
    el.setAttribute('slot', name);
    // moveBefore() keeps focus, animations and iframes alive across the move.
    if (el.parentNode !== this) move(this, el, null);
    return el;
  }

  /** Put an adopted element back where it came from. With no argument, all of them. */
  release(el) {
    if (el === undefined) {
      for (const node of [...this.#adopted.keys()]) this.release(node);
      return;
    }
    if (typeof el === 'string') el = this.querySelector(el);
    const rec = el && this.#adopted.get(el);
    if (!rec) return null;
    this.#adopted.delete(el);
    if (rec.slot === null) el.removeAttribute('slot'); else el.setAttribute('slot', rec.slot);
    if (!rec.drawable) el.removeAttribute('drawable');
    const home = rec.marker.parentNode;
    if (home) {
      move(home, el, rec.marker);
      rec.marker.remove();
    } else {
      this.after(el); // its old home is gone
    }
    return el;
  }

  /** The elements currently adopted from elsewhere. */
  get adopted() {
    return [...this.#adopted.keys()];
  }

  // from="selector": adopt what matches, release what no longer does.
  #syncFrom() {
    const selector = this.getAttribute('from');
    let want = [];
    if (selector) {
      try { want = [...document.querySelectorAll(selector)].filter((el) => el !== this && !el.contains(this)); } catch { want = []; }
    }
    for (const [el, rec] of [...this.#adopted]) if (rec.viaFrom && !want.includes(el)) this.release(el);
    for (const el of want) {
      if (el.parentNode === this && !this.#adopted.has(el)) continue;
      if (this.adopt(el)) this.#adopted.get(el).viaFrom = true;
    }
  }

  /** Post an arbitrary message to the worker (worker mode only). */
  postToWorker(message, transfer = []) {
    this.#worker?.postMessage(message, transfer);
  }

  requestPaint() {
    if (SUPPORTED && !this.#gaveUp) this.#canvas.requestPaint();
  }

  #gaveUp = false;
  /**
   * Give up on the canvas at run time (it was lost for good, or draws
   * nothing): the slots move out of it, so the content is ordinary HTML,
   * with a short note saying why.
   */
  showPlain(reason = 'the canvas stopped drawing') {
    if (this.#gaveUp || this.#mode === 'worker') return;
    this.#gaveUp = true;
    this.#loading++;
    this.#fx?.destroy();
    this.#fx = null;
    cancelAnimationFrame(this.#raf);
    for (const slot of this.#slots.values()) this.#root.append(slot);
    const note = document.createElement('small');
    note.setAttribute('part', 'notice');
    note.style.cssText = 'display:block;font:11px system-ui;opacity:.7;margin-top:2px';
    note.textContent = `Shown as plain HTML (${reason}).`;
    this.#root.append(note);
    this.setAttribute('plain', reason);
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
      // #region worker
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
      // #endregion worker
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
      try {
        ctx.drawElementImage(el, x, y, w ?? el.offsetWidth, h ?? el.offsetHeight);
        this.#retries = 0;
      } catch (err) {
        // An element that was slotted or moved a moment ago may not have been
        // laid out inside the canvas yet, and a canvas that is scrolled far
        // off screen has no painted content to draw. Skip the element this
        // frame and paint again: quickly at first, then twice a second.
        if (this.#retries++ < 3) requestAnimationFrame(() => this.requestPaint());
        else {
          if (this.#retries === 4) console.warn('<canvas-slot>: could not draw', el, err.message);
          clearTimeout(this.#retryTimer);
          this.#retryTimer = setTimeout(() => this.requestPaint(), 500);
        }
      }
    };
    const renderer = this.onrender ?? defaultRenderer;
    renderer({ ctx, canvas: this.#canvas, width, height, dpr, elements, draw, time: performance.now(), event });
    // Let others (e.g. slot-share.js) react to a finished frame.
    this.dispatchEvent(new CustomEvent('render', { detail: { elements, changed: new Set(event.changedElements ?? []), dpr } }));
  }
}

// moveBefore() keeps focus, animations and iframes alive across a move, so it
// is used when the browser has it. One exception, found the hard way in
// Chrome 157: an element moved out of a drawable canvas and back in with
// moveBefore() before a frame has been rendered can no longer be drawn ("can
// only be drawn into its nearest ancestor <canvas>"). A second move of the
// same element within a frame therefore uses an ordinary insert.
const justMoved = new WeakSet();
function move(parent, el, before) {
  if (parent.moveBefore && el.isConnected && parent.isConnected && !justMoved.has(el)) {
    try {
      parent.moveBefore(el, before);
      justMoved.add(el);
      requestAnimationFrame(() => requestAnimationFrame(() => justMoved.delete(el)));
      return;
    } catch {}
  }
  parent.insertBefore(el, before);
}

function defaultRenderer({ width, elements, draw }) {
  let y = 0;
  for (const [, el] of elements) {
    draw(el, (width - el.offsetWidth) / 2, y);
    y += el.offsetHeight + 8;
  }
}

if (!customElements.get('canvas-slot')) customElements.define('canvas-slot', CanvasSlot);
