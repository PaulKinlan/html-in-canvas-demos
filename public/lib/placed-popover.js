// PlacedPopover: a popover whose content is drawn by a canvas, one element at a
// time, wherever a function says. It is the shared part of the canvas-drawn
// pickers in datalist-picker.js and input-pickers.js.
//
//   const pop = new PlacedPopover({
//     anchor: input,                         // the popover opens next to this element
//     items: () => [...list.children],       // the elements to draw, in order
//     size: (s) => [260, 200],               // CSS px
//     place: (i, s) => ({ x, y, scale, rotate, alpha, order }),   // or null to hide item i
//     under: (ctx, s) => {},                 // optional 2D drawing below the items
//   });
//   pop.adopt(list);                         // the elements must be inside the canvas
//   pop.show();
//
// place() gives the target for item i: x and y are the item's top left corner
// in canvas CSS px, scale and rotate (degrees) apply about its centre. The
// popover moves each item towards its target a little every frame, so a
// change of target is an animation. An item that returns null, or alpha 0,
// fades out and its hit box is moved away.
//
// The items stay real elements: buttons can be focused and pressed, options
// can be clicked. drawElementImage() sets each one's hit box where it is drawn.

export const supported = typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype && typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

const FAR = new DOMMatrix().translate(-1e5, -1e5);
let anchors = 0;

const CSS_TEXT = `
.placed-popover { position: fixed; inset: auto; margin: 6px 0; padding: 0; border: 0; background: none; overflow: visible; color: inherit;
  position-area: bottom span-right; position-try-fallbacks: flip-block, bottom span-left, top span-left, bottom, top; }
.placed-popover > canvas { display: block; touch-action: manipulation; border-radius: 14px; background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText);
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent); box-shadow: 0 10px 34px rgb(0 0 0 / .28); }
`;

export class PlacedPopover {
  /** Frames drawn, for tests. */
  frames = 0;
  /** Set when the canvas could not be used. */
  note = '';
  #running = false;
  #dirty = true;
  #state = new WeakMap(); // item → its current x, y, scale, rotate, alpha
  #last = 0;
  #shownAt = 0;

  constructor({ anchor, items, size, place, prepare, under, over, className = '', onhide }) {
    Object.assign(this, { anchor, items, size, place, prepare, under, over, onhide });
    this.s = { dt: 0.016, w: 0, h: 0, n: 0, sizes: [], open: 0, px: 0, py: 0, pointer: false, ink: '#000', accent: '#06c' };
    const root = anchor.getRootNode();
    const head = root.nodeType === 9 ? root.head : root;
    if (!head.querySelector('style[data-placed-popover]')) {
      const style = document.createElement('style');
      style.dataset.placedPopover = '';
      style.textContent = CSS_TEXT;
      head.prepend(style);
    }
    const host = (this.host = document.createElement('div'));
    host.className = `placed-popover ${className}`.trim();
    host.popover = 'manual';
    const name = `--placed-popover-${++anchors}`;
    anchor.style.anchorName = name;
    host.style.positionAnchor = name;
    this.#newCanvas();
    (anchor.closest(':popover-open, dialog[open]') ?? document.body).append(host);
    host.addEventListener('pointermove', (e) => this.#pointer(e, true));
    host.addEventListener('pointerdown', (e) => this.#pointer(e, true));
    host.addEventListener('pointerleave', (e) => this.#pointer(e, false));
    // A press outside the popover and its anchor closes it.
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !e.composedPath().includes(host) && !e.composedPath().includes(anchor)) this.hide();
    }, true);
  }

  #newCanvas() {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', ''); // the attribute's name in older Chrome versions
    if (this.canvas) { canvas.append(...this.canvas.childNodes); this.canvas.replaceWith(canvas); } else this.host.append(canvas);
    this.canvas = canvas;
    canvas.addEventListener('paint', () => this.#draw());
    // A lost canvas is replaced by a fresh one, twice. After that the popover is left as it is and says so.
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if ((this.losses = (this.losses ?? 0) + 1) <= 2) { this.#newCanvas(); this.invalidate(); } else this.note = 'the canvas lost its context three times';
    });
  }

  #pointer(e, over) {
    const r = this.canvas.getBoundingClientRect();
    this.s.px = e.clientX - r.left;
    this.s.py = e.clientY - r.top;
    this.s.pointer = over && e.pointerType === 'mouse' ? true : over && e.type !== 'pointerleave' && e.buttons > 0;
    this.invalidate();
  }

  /** Move an element (and the items inside it) into the canvas. */
  adopt(node) {
    this.canvas.append(node);
    return node;
  }

  get open() {
    return this.host.matches(':popover-open');
  }

  show() {
    if (this.open) return this.invalidate();
    this.host.showPopover();
    this.#shownAt = performance.now();
    this.s.open = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
    this.#state = new WeakMap();
    const style = getComputedStyle(this.canvas);
    this.s.ink = style.color;
    this.s.accent = style.getPropertyValue('--picker-accent').trim() || '#0a66d0';
    this.invalidate();
  }

  hide() {
    if (!this.open) return;
    this.host.hidePopover();
    this.onhide?.();
  }

  /** Something changed: draw again. */
  invalidate() {
    this.#dirty = true;
    if (!this.open) return;
    if (!this.#running) { this.#running = true; this.#last = performance.now(); requestAnimationFrame(this.#tick); }
  }

  /** Put every item at its target at once, with no animation. */
  snap() {
    this.#state = new WeakMap();
    this.invalidate();
  }

  /** Start one item from somewhere else, so it animates to its target. */
  from(item, values) {
    const st = this.#state.get(item);
    if (st) Object.assign(st, values);
    else this.#state.set(item, { x: 0, y: 0, scale: 1, rotate: 0, alpha: 0, fresh: true, ...values, seeded: true });
    this.invalidate();
  }

  #tick = (now) => {
    if (!this.open) { this.#running = false; return; }
    this.dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    if (this.s.open < 1) {
      const t = Math.min(1, (now - this.#shownAt) / 240);
      this.s.open = 1 - (1 - t) ** 3;
      this.#dirty = true;
    }
    if (this.#dirty) { this.#dirty = false; this.canvas.requestPaint(); requestAnimationFrame(this.#tick); } else this.#running = false;
  };

  // #region draw
  #draw() {
    if (!this.open) return;
    const { canvas, s } = this;
    const items = this.items();
    s.n = items.length;
    s.sizes = items.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
    this.prepare?.(s);
    const [w, h] = this.size(s);
    if (w !== s.w || h !== s.h) { s.w = w; s.h = h; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
    const dpr = devicePixelRatio || 1;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    s.dt = this.dt ?? 0.016;
    const k = 1 - Math.exp(-(this.dt ?? 0.016) * 14); // how far to move towards the target this frame
    const shown = [];
    let moving = false;
    for (const [i, el] of items.entries()) {
      const target = this.place(i, s);
      const to = { x: 0, y: 0, scale: 1, rotate: 0, alpha: 1, order: 0, ...(target ?? { alpha: 0 }) };
      let st = this.#state.get(el);
      if (!st || st.seeded) {
        // First frame for this item: start at the target, unless from() gave it a starting point.
        st = { ...to, ...(st ?? {}), seeded: false };
        if (!target) Object.assign(st, { alpha: 0 });
        this.#state.set(el, st);
      }
      if (!target) { to.x = st.x; to.y = st.y; to.scale = st.scale; to.rotate = st.rotate; }
      for (const key of ['x', 'y', 'scale', 'rotate', 'alpha']) {
        const gap = to[key] - st[key];
        if (Math.abs(gap) > (key === 'alpha' || key === 'scale' ? 0.004 : 0.2)) { st[key] += gap * k; moving = true; } else st[key] = to[key];
      }
      if (st.alpha > 0.02) shown.push({ el, size: s.sizes[i], st, order: to.order });
      else canvas.updateElementGeometry(el, { canvasTransform: FAR }); // an item that is not drawn keeps its last hit box
    }
    shown.sort((a, b) => a.order - b.order);
    try {
      const ctx = canvas.getContext('2d');
      ctx.reset();
      ctx.scale(dpr, dpr);
      // under() and over() return true to ask for another frame.
      if (this.under) { ctx.save(); if (this.under(ctx, s) === true) moving = true; ctx.restore(); }
      for (const { el, size, st } of shown) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, st.alpha) * s.open;
        ctx.translate(st.x + size.w / 2, st.y + size.h / 2);
        if (st.rotate) ctx.rotate((st.rotate * Math.PI) / 180);
        if (st.scale !== 1) ctx.scale(st.scale, st.scale);
        // Draws the element and moves its hit box to the same place.
        ctx.drawElementImage(el, -size.w / 2, -size.h / 2, size.w, size.h);
        ctx.restore();
      }
      if (this.over) { ctx.save(); if (this.over(ctx, s) === true) moving = true; ctx.restore(); }
      this.frames++;
    } catch (err) {
      // "No cached paint record" on the first frame after show(): the next paint event draws.
      if (!/paint record/.test(err.message)) this.note = err.message;
      moving = true;
    }
    if (moving) this.invalidate();
  }
  // #endregion draw
}
