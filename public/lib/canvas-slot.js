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

  static get supported() {
    return SUPPORTED;
  }

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `
      <style>
        :host { display: block; position: relative; contain: layout; }
        canvas { display: block; width: 100%; height: 100%; }
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
    try {
      this.#ro.observe(this.#canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#ro.observe(this.#canvas);
    }

    if (!SUPPORTED) return;

    const workerUrl = this.getAttribute('worker');
    if (workerUrl) {
      this.#worker = new Worker(new URL(workerUrl, document.baseURI), { type: 'module' });
      this.#worker.onmessage = (e) => this.dispatchEvent(new CustomEvent('workermessage', { detail: e.data }));
      const offscreen = this.#canvas.transferControlToOffscreen();
      this.#worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
    } else {
      this.#ctx = this.#canvas.getContext('2d');
    }
    this.#canvas.addEventListener('paint', (e) => this.#onPaint(e));
  }

  #mo;
  #ro;

  disconnectedCallback() {
    this.#mo?.disconnect();
    this.#ro?.disconnect();
    cancelAnimationFrame(this.#raf);
    this.#worker?.terminate();
    this.#worker = null;
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
      this.#canvas.append(slot);
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

    const ctx = this.#ctx;
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
