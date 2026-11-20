// <dom-rewind>: a DVR for a piece of UI.
//
//   <dom-rewind seconds="30" trails="6" style="height: 400px">
//     <div class="card">…any HTML…</div>
//     <div class="card">…</div>
//   </dom-rewind>
//
//   rw.place(card, { x, y, rotate })   // children are positioned by the element
//   rw.seek(2.5)                       // show the UI as it was 2.5 s ago
//   rw.live()                          // back to now
//   rw.replay(5)                       // play the last five seconds, then go live
//   rw.restore()                       // make the moment on screen the present
//
// Every child is slotted into a 2D canvas. Each time a child repaints, the
// element keeps an ElementImage of it (a snapshot the browser can redraw
// later) together with where it was drawn. A frame in the history is a list
// of { snapshot, x, y, rotate }; snapshots are shared between frames until
// the child actually changes, so moving a card for a minute costs one
// snapshot. Scrubbing draws an old frame; trails draw several faded ones
// under the live elements.
//
// restore() goes further than pixels: each frame also keeps form values,
// checked boxes, open <details>, scroll positions and whatever `oncapture`
// returned, and puts them back.

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype &&
  'captureElementImage' in HTMLCanvasElement.prototype;

export class DomRewind extends HTMLElement {
  static supported = SUPPORTED;

  /** Return any structured-cloneable app state to store with a frame. */
  oncapture = null;
  /** Receive that state back on restore(). */
  onrestore = null;

  #canvas; #ctx; #dpr = 1;
  #items = new Map();      // child -> { el, wrap, slot, x, y, rotate, img, w, h }
  #frames = [];            // { t, items: [{ item, img, x, y, rotate, w, h }], state }
  #refs = new Map();       // ElementImage -> refcount
  #clock = 0;              // recorded seconds
  #last = 0;
  #ago = 0;                // seconds behind live; 0 = live
  #raf = 0;
  #dirty = true;
  #lastState = null;
  #replaying = null;
  #ro; #mo; #seq = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get supported() { return SUPPORTED; }
  get canvas() { return this.#canvas; }
  /** Seconds of history held. */
  get duration() { return this.#frames.length ? this.#clock - this.#frames[0].t : 0; }
  /** Seconds behind live (0 when live). */
  get position() { return this.#ago; }
  get isLive() { return this.#ago === 0; }
  get capacity() { return Number(this.getAttribute('seconds') ?? 30); }
  get trails() { return Number(this.getAttribute('trails') ?? 0); }
  set trails(n) { this.setAttribute('trails', n); }
  /** Seconds between ghosts. */
  get trailGap() { return Number(this.getAttribute('trail-gap') ?? 0.06); }
  set trailGap(s) { this.setAttribute('trail-gap', s); }
  get stats() { return { frames: this.#frames.length, snapshots: this.#refs.size, seconds: this.duration }; }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length) return;
    if (!SUPPORTED) {
      // Plain fallback: children are positioned with transforms, nothing is recorded.
      this.shadowRoot.innerHTML = `<style>:host{display:block;position:relative;overflow:hidden}::slotted(*){position:absolute;left:0;top:0}</style><slot></slot>`;
      for (const el of this.children) {
        this.#items.set(el, { el, x: 0, y: 0, rotate: 0 });
        this.place(el, { x: Number(el.dataset.x ?? 0), y: Number(el.dataset.y ?? 0), rotate: Number(el.dataset.rotate ?? 0) });
      }
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; overflow: hidden; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .item { position: absolute; left: 0; top: 0; width: max-content; }
        :host([past]) .item { pointer-events: none; }
      </style>
      <canvas content="drawable" layoutsubtree></canvas>`;
    this.#canvas = this.shadowRoot.querySelector('canvas');
    this.#ctx = this.#canvas.getContext('2d');
    this.#sync();
    this.#mo = new MutationObserver(() => this.#sync());
    this.#mo.observe(this, { childList: true });
    this.#ro = new ResizeObserver(() => this.#resize());
    this.#ro.observe(this);
    this.#canvas.addEventListener('paint', (e) => this.#paint(e));
    const tick = () => { this.#canvas.requestPaint(); this.#raf = requestAnimationFrame(tick); };
    this.#raf = requestAnimationFrame(tick);
  }

  disconnectedCallback() { cancelAnimationFrame(this.#raf); }

  // ------------------------------------------------------------ public API

  /** Position a child. Coordinates are CSS px from the element's top left; rotate is in radians. */
  place(el, { x, y, rotate } = {}) {
    const it = this.#items.get(el);
    if (!it) return;
    if (x !== undefined) it.x = x;
    if (y !== undefined) it.y = y;
    if (rotate !== undefined) it.rotate = rotate;
    this.#dirty = true;
    if (!SUPPORTED) el.style.transform = `translate(${it.x}px, ${it.y}px) rotate(${it.rotate}rad)`;
  }

  placement(el) {
    const it = this.#items.get(el);
    return it ? { x: it.x, y: it.y, rotate: it.rotate } : null;
  }

  /** Show the UI as it was `secondsAgo` seconds of recorded time ago. Recording pauses while in the past. */
  seek(secondsAgo) {
    if (!SUPPORTED) return;
    this.#replaying = null;
    this.#setAgo(secondsAgo);
  }

  live() { this.seek(0); }

  /** Play back the last `seconds` at `rate`, then return to live. Resolves when done. */
  replay(seconds = 5, rate = 1) {
    if (!SUPPORTED) return Promise.resolve();
    this.#setAgo(Math.min(seconds, this.duration));
    return new Promise((resolve) => { this.#replaying = { rate, last: performance.now(), resolve }; });
  }

  /** Make the moment on screen the present: put back form state and positions, drop the future. */
  restore() {
    if (!SUPPORTED || this.#ago === 0) return false;
    const frame = this.#frameAt(this.#clock - this.#ago);
    if (!frame) return false;
    for (const f of frame.items) { f.item.x = f.x; f.item.y = f.y; f.item.rotate = f.rotate; }
    if (frame.state) {
      for (const [el, kind, value] of frame.state.form) applyField(el, kind, value);
      this.onrestore?.(frame.state.app);
    }
    // Drop what came after.
    while (this.#frames.length && this.#frames.at(-1).t > frame.t) this.#release(this.#frames.pop());
    this.#clock = frame.t;
    this.#lastState = frame.state;
    this.#replaying = null;
    this.#setAgo(0);
    this.#dirty = true;
    this.dispatchEvent(new CustomEvent('rewindrestore'));
    return true;
  }

  /** Forget the history. */
  clear() {
    for (const f of this.#frames) this.#release(f);
    this.#frames.length = 0;
    for (const it of this.#items.values()) it.img = null;
    this.#dirty = true;
  }

  // ------------------------------------------------------------ internals

  #setAgo(v) {
    this.#ago = Math.max(0, Math.min(Number(v) || 0, this.duration));
    this.toggleAttribute('past', this.#ago > 0);
    this.#last = performance.now();
  }

  #sync() {
    const seen = new Set();
    for (const el of this.children) {
      seen.add(el);
      if (this.#items.has(el)) continue;
      const wrap = document.createElement('div');
      wrap.className = 'item';
      wrap.setAttribute('drawable', '');
      const slot = document.createElement('slot');
      slot.name = el.slot = `rw-${this.#seq++}`;
      wrap.append(slot);
      this.#canvas.append(wrap);
      this.#items.set(el, { el, wrap, slot, x: Number(el.dataset.x ?? 0), y: Number(el.dataset.y ?? 0), rotate: Number(el.dataset.rotate ?? 0), img: null, w: 0, h: 0 });
    }
    for (const [el, it] of this.#items) {
      if (seen.has(el)) continue;
      it.wrap.remove();
      this.#items.delete(el);
    }
    this.#dirty = true;
  }

  #resize() {
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.clientWidth * dpr)), h = Math.max(1, Math.round(this.clientHeight * dpr));
    if (w === this.#canvas.width && h === this.#canvas.height && dpr === this.#dpr) return;
    // Snapshots survive a canvas resize, so the history is kept.
    this.#canvas.width = w; this.#canvas.height = h; this.#dpr = dpr;
    this.#dirty = true;
  }

  #retain(img) { this.#refs.set(img, (this.#refs.get(img) ?? 0) + 1); }
  #release(frame) {
    for (const f of frame.items) {
      const n = (this.#refs.get(f.img) ?? 1) - 1;
      if (n > 0) { this.#refs.set(f.img, n); continue; }
      this.#refs.delete(f.img);
      if ([...this.#items.values()].some((it) => it.img === f.img)) continue; // still the current snapshot
      f.img.close?.();
    }
  }

  #frameAt(t) {
    const fr = this.#frames;
    if (!fr.length) return null;
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid].t <= t) lo = mid; else hi = mid - 1; }
    return fr[lo];
  }

  #record(event) {
    const changed = new Set(event.changedElements ?? [...this.#items.values()].map((i) => i.wrap));
    let any = this.#dirty || !this.#frames.length;
    for (const it of this.#items.values()) {
      if (it.img && !changed.has(it.wrap)) continue;
      try {
        it.img = this.#canvas.captureElementImage(it.wrap);
        it.w = it.wrap.offsetWidth; it.h = it.wrap.offsetHeight;
        any = true;
      } catch { /* not painted yet */ }
    }
    if (!any) return;
    const items = [];
    for (const it of this.#items.values()) {
      if (!it.img) continue;
      this.#retain(it.img);
      items.push({ item: it, img: it.img, x: it.x, y: it.y, rotate: it.rotate, w: it.w, h: it.h });
    }
    // Form state only changes when something repainted (or on the first frame).
    let state = this.#lastState;
    if (!state || changed.size) {
      const form = captureForm(this);
      const app = this.oncapture ? this.oncapture() : undefined;
      const key = JSON.stringify([form.map((f) => f[2]), app]);
      if (!state || state.key !== key) state = { form, app, key };
      this.#lastState = state;
    }
    this.#frames.push({ t: this.#clock, items, state });
    const cap = this.capacity;
    while (this.#frames.length > 2 && (this.#frames[1].t < this.#clock - cap || this.#frames.length > 6000)) this.#release(this.#frames.shift());
    this.#dirty = false;
  }

  #drawItem(ctx, src, w, h, x, y, rotate) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (rotate) ctx.rotate(rotate);
    ctx.drawElementImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  #paint(event) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.#last || now)) / 1000);
    this.#last = now;
    const ctx = this.#ctx;

    if (this.#replaying) {
      this.#ago = Math.max(0, this.#ago - dt * this.#replaying.rate);
      if (this.#ago === 0) { const r = this.#replaying; this.#replaying = null; this.#setAgo(0); r.resolve(); }
    }
    if (this.#ago === 0) {
      this.#clock += dt;
      this.#record(event);
    }

    ctx.reset();
    ctx.scale(this.#dpr, this.#dpr);

    if (this.#ago > 0) {
      const frame = this.#frameAt(this.#clock - this.#ago);
      if (frame) for (const f of frame.items) this.#drawItem(ctx, f.img, f.w, f.h, f.x, f.y, f.rotate);
    } else {
      const n = this.trails, gap = this.trailGap;
      for (let i = n; i >= 1; i--) {
        const frame = this.#frameAt(this.#clock - i * gap);
        if (!frame) continue;
        ctx.globalAlpha = 0.5 * (1 - i / (n + 1));
        for (const f of frame.items) {
          const it = f.item;
          // Only things that moved leave a trail; a ghost exactly under the element adds nothing.
          if (Math.abs(f.x - it.x) + Math.abs(f.y - it.y) + Math.abs(f.rotate - it.rotate) * 50 < 0.75) continue;
          this.#drawItem(ctx, f.img, f.w, f.h, f.x, f.y, f.rotate);
        }
      }
      ctx.globalAlpha = 1;
      // Live elements go last: drawing an element (or one of its snapshots) moves its hit box.
      for (const it of this.#items.values()) {
        try { this.#drawItem(ctx, it.wrap, it.wrap.offsetWidth, it.wrap.offsetHeight, it.x, it.y, it.rotate); } catch { /* not painted yet */ }
      }
    }
    this.dispatchEvent(new CustomEvent('rewindframe', { detail: { position: this.#ago, duration: this.duration } }));
  }
}

const FIELDS = 'input, textarea, select, details, [contenteditable], [data-rewind-scroll]';

function captureForm(root) {
  const out = [];
  for (const el of root.querySelectorAll(FIELDS)) {
    if (el.matches('input[type=checkbox], input[type=radio]')) out.push([el, 'checked', el.checked]);
    else if (el.matches('input, textarea, select')) out.push([el, 'value', el.value]);
    else if (el.matches('details')) out.push([el, 'open', el.open]);
    else if (el.matches('[contenteditable]')) out.push([el, 'html', el.innerHTML]);
    if (el.matches('[data-rewind-scroll], textarea')) out.push([el, 'scroll', el.scrollTop]);
  }
  return out;
}

function applyField(el, kind, value) {
  if (kind === 'checked') el.checked = value;
  else if (kind === 'value') { if (el.value !== value) el.value = value; }
  else if (kind === 'open') el.open = value;
  else if (kind === 'html') { if (el.innerHTML !== value) el.innerHTML = value; }
  else if (kind === 'scroll') el.scrollTop = value;
}

if (!customElements.get('dom-rewind')) customElements.define('dom-rewind', DomRewind);
