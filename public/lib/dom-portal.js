// <dom-portal>: show any live element a second time, somewhere else on the
// page, and keep it interactive in both places.
//
//   <script type="module" src="/lib/dom-portal.js"></script>
//
//   <aside id="cart">…</aside>
//   …
//   <dom-portal for="cart" scale="0.5"></dom-portal>
//
// Nothing is cloned. There is still exactly one #cart in the DOM, the
// accessibility tree and your event listeners. The portal is a second drawing
// of it.
//
// How: HTML-in-canvas can only draw descendants of a canvas, and an element's
// snapshot only draws into its own canvas. So the source is wrapped in a
// <dom-portal-source> whose shadow root slots it into one canvas that covers
// both the element's home and every portal that points at it (the union of
// their boxes). That canvas draws the element at home, and again in each
// portal. The element has one hit-test geometry, so it is pointed at whichever
// copy the pointer is over: you can click, type and select in either.
//
// <dom-portal> attributes
//   for     id (or selector) of the element to mirror
//   scale   size of the copy relative to the original (default 1)
//   fit     size the portal with CSS instead and scale the copy to fit inside
//
// <dom-portal-source> attributes (optional; created for you if you don't write it)
//   inline  shrink-wrap the content instead of filling the line
//   layer   "top" draws through a top-layer canvas (popover), which escapes
//           overflow clipping and transforms on ancestors at the cost of
//           always painting above the page
//
// Without HTML-in-canvas a portal shows an inert, unfocusable clone instead.

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

const MAX_DIM = 8192;

const SOURCE_CSS = `
  :host { display: block; position: relative; }
  :host([inline]) { display: inline-block; vertical-align: top; }
  #sizer { pointer-events: none; }
  canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; z-index: var(--dom-portal-z, 1000); }
  canvas[popover] { position: fixed; inset: auto; left: 0; top: 0; margin: 0; border: 0; padding: 0; background: none; overflow: visible; max-width: none; max-height: none; }
  #content { position: absolute; left: 0; top: 0; display: flow-root; box-sizing: border-box; pointer-events: auto; }
  :host([inline]) #content { width: max-content; }
  /* An adopted element's margins move to the host so they still collapse with its neighbours. */
  :host([adopted]) ::slotted(*) { margin: 0 !important; }
`;

const pointer = { x: -1, y: -1, known: false };
if (typeof window !== 'undefined') {
  const track = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.known = true;
  };
  addEventListener('pointermove', track, { capture: true, passive: true });
  // A touch has no move before it lands. Retarget on pointerdown so the
  // geometry is right by the time the tap's click is hit tested.
  addEventListener(
    'pointerdown',
    (e) => {
      track(e);
      for (const s of DomPortalSource.instances) s.update(true);
    },
    { capture: true, passive: true },
  );
}

export class DomPortalSource extends HTMLElement {
  static instances = new Set();
  static get supported() {
    return SUPPORTED;
  }

  /** Wrap `target` (any element) in a source, in place. Returns the source. */
  static adopt(target) {
    if (target instanceof DomPortalSource) return target;
    const parent = target.parentElement;
    if (parent instanceof DomPortalSource && parent.children.length === 1) return parent;
    const host = document.createElement('dom-portal-source');
    const cs = getComputedStyle(target);
    const ps = parent ? getComputedStyle(parent) : null;
    const isItem = /flex|grid/.test(ps?.display ?? '');
    // Grid items and column-flex items normally stretch across their track, so
    // the host fills it like a block. Row-flex items are sized by their content.
    const stretches = isItem && (/grid/.test(ps.display) || ps.flexDirection.startsWith('column')) && /normal|stretch|auto/.test(/grid/.test(ps.display) ? cs.justifySelf : cs.alignSelf);
    if (cs.display.startsWith('inline') || (isItem && !stretches)) host.setAttribute('inline', '');
    if (isItem) for (const p of ['flex', 'align-self', 'justify-self', 'order', 'grid-area']) host.style.setProperty(p, cs.getPropertyValue(p));
    host.style.margin = cs.margin;
    host.setAttribute('adopted', '');
    const focused = target.contains(document.activeElement) ? document.activeElement : null;
    target.replaceWith(host);
    host.append(target);
    focused?.focus({ preventScroll: true });
    return host;
  }

  #root;
  #sizer;
  #canvas;
  #content;
  #ctx;
  #portals = new Set();
  #raf = 0;
  #observers = [];
  #key = '';
  #dirty = true;
  #painted = false;
  #top = false;
  width = 0;
  height = 0;
  /** The portal (or null for home) that currently owns hit testing. */
  active = null;
  /** Diagnostics for the demo page. */
  stats = { mode: 'idle', canvas: [0, 0], draws: 0, frames: 0 };

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    if (!SUPPORTED) {
      this.#root.innerHTML = '<slot></slot>';
      return;
    }
    this.#root.innerHTML = `<style>${SOURCE_CSS}</style><div id="sizer"></div><canvas part="canvas" content="drawable" layoutsubtree><div id="content" drawable><slot></slot></div></canvas>`;
    this.#sizer = this.#root.getElementById('sizer');
    this.#canvas = this.#root.querySelector('canvas');
    this.#content = this.#root.getElementById('content');
    this.#canvas.addEventListener('paint', () => {
      this.#painted = true;
      this.#dirty = true;
      this.update();
    });
  }

  get canvas() {
    return this.#canvas;
  }
  get portals() {
    return [...this.#portals];
  }

  connectedCallback() {
    if (!SUPPORTED) return;
    DomPortalSource.instances.add(this);
    this.#ctx ??= this.#canvas.getContext('2d');
    const inline = () => this.hasAttribute('inline');
    const hostRO = new ResizeObserver(() => {
      this.#content.style.width = inline() ? '' : this.clientWidth + 'px';
    });
    hostRO.observe(this);
    const contentRO = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      this.width = box ? box.inlineSize : entry.contentRect.width;
      this.height = box ? box.blockSize : entry.contentRect.height;
      this.#sizer.style.height = this.height + 'px';
      this.#sizer.style.width = inline() ? this.width + 'px' : '';
      for (const p of this.#portals) p.sourceResized(this.width, this.height);
      this.#dirty = true;
    });
    contentRO.observe(this.#content);
    this.#observers.push(hostRO, contentRO);
    this.#canvas.requestPaint();
    this.#loop();
  }

  disconnectedCallback() {
    DomPortalSource.instances.delete(this);
    for (const o of this.#observers) o.disconnect();
    this.#observers = [];
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  attach(portal) {
    this.#portals.add(portal);
    if (this.width) portal.sourceResized(this.width, this.height);
    this.#dirty = true;
    this.#loop();
  }

  detach(portal) {
    this.#portals.delete(portal);
    this.#dirty = true;
  }

  // Positions can change without any event we could listen for (scrolling
  // containers, layout shifts, animations), so the boxes are re-read every
  // frame. Drawing only happens when something actually moved or repainted.
  #loop() {
    if (this.#raf || !this.isConnected || !SUPPORTED) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.update();
      this.#loop();
    });
  }

  // canvasTransform works in CSS px on some canvases and canvas-buffer px on
  // others (it only matters on high-DPI screens). Measure instead of guessing:
  // apply the identity and see how wide the element reports itself.
  #unitKey = '';
  #unitValue = 1;
  #unit(cssWidth) {
    const c = this.#canvas;
    const key = `${c.width}x${c.height}/${c.clientWidth}x${c.clientHeight}/${Math.round(cssWidth)}`;
    if (key === this.#unitKey) return this.#unitValue;
    c.updateElementGeometry(this.#content, { canvasTransform: new DOMMatrix() });
    const measured = this.#content.getBoundingClientRect().width;
    if (measured > 0) {
      this.#unitValue = cssWidth / measured;
      this.#unitKey = key;
    }
    return this.#unitValue;
  }

  /** Recompute the canvas box and redraw if anything changed. */
  update(force = false) {
    if (!this.#painted || !this.width || !this.isConnected) return;
    const home = this.getBoundingClientRect();
    const w = this.width;
    const h = this.height;
    const frames = [];
    for (const p of this.#portals) {
      const f = p.frame(w, h);
      if (f) frames.push(f);
    }

    // The canvas covers the union of home and every portal, so it scrolls with
    // the page and needs no redraw while scrolling. If that union is huge (or
    // layer="top"), fall back to a viewport-sized canvas redrawn every frame.
    let x0 = home.left, y0 = home.top, x1 = home.left + w, y1 = home.top + h;
    for (const f of frames) {
      x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y);
      x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h);
    }
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    const wantTop = this.getAttribute('layer') === 'top';
    const dpr = devicePixelRatio;
    const tooBig = (x1 - x0) * dpr > MAX_DIM || (y1 - y0) * dpr > MAX_DIM || (x1 - x0) * (y1 - y0) > 6 * innerWidth * innerHeight;
    let mode = 'union';
    if (wantTop || tooBig) {
      mode = wantTop ? 'top' : 'viewport';
      x0 = 0; y0 = 0; x1 = innerWidth; y1 = innerHeight;
    }
    if (wantTop !== this.#top) {
      this.#top = wantTop;
      if (wantTop) {
        this.#canvas.setAttribute('popover', 'manual');
        this.#canvas.showPopover();
      } else {
        this.#canvas.hidePopover?.();
        this.#canvas.removeAttribute('popover');
      }
      this.#dirty = true;
    }
    const cw = x1 - x0;
    const ch = y1 - y0;
    const style = this.#canvas.style;
    const left = mode === 'top' ? 0 : x0 - home.left - this.clientLeft;
    const top = mode === 'top' ? 0 : y0 - home.top - this.clientTop;
    if (style.left !== left + 'px') style.left = left + 'px';
    if (style.top !== top + 'px') style.top = top + 'px';
    if (style.width !== cw + 'px') style.width = cw + 'px';
    if (style.height !== ch + 'px') style.height = ch + 'px';
    const pw = Math.max(1, Math.round(cw * dpr));
    const ph = Math.max(1, Math.round(ch * dpr));
    if (this.#canvas.width !== pw || this.#canvas.height !== ph) {
      this.#canvas.width = pw;
      this.#canvas.height = ph;
      this.#dirty = true;
    }
    const k = pw / cw;

    // Which copy is the pointer over? That one gets the hit-test geometry.
    let active = null;
    if (pointer.known) {
      for (const f of frames) {
        if (pointer.x >= f.x && pointer.x < f.x + f.w && pointer.y >= f.y && pointer.y < f.y + f.h) active = f;
      }
    }

    // Hit testing must not reach past what is visible: a copy scaled to fit
    // can overflow its portal, and in the viewport modes an ancestor may clip
    // the element. canvasClip is in the element's own coordinates.
    const clipped = mode !== 'union';
    let clip = null;
    if (active) {
      let { x, y, w: fw, h: fh } = active;
      if (clipped) ({ x, y, w: fw, h: fh } = intersect(active, visibleBox(active.portal)));
      clip = [(x - active.cx) / active.s, (y - active.cy) / active.s, fw / active.s, fh / active.s];
    } else if (clipped) {
      const v = visibleBox(this);
      clip = [v.x - home.left, v.y - home.top, v.w, v.h];
    }

    let key = `${home.left - x0},${home.top - y0},${w},${h},${cw},${ch},${mode},${active?.portal.uid ?? 'home'},${clip ? clip.map(Math.round) : ''}`;
    for (const f of frames) key += `|${f.x - x0},${f.y - y0},${f.w},${f.h},${f.s}`;
    if (!this.#dirty && !force && key === this.#key) return;
    this.#key = key;
    this.#dirty = false;

    const ctx = this.#ctx;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    let draws = 0;
    try {
      // Home.
      ctx.save();
      if (clipped) clipTo(ctx, visibleBox(this), x0, y0);
      ctx.drawElementImage(this.#content, home.left - x0, home.top - y0, w, h);
      ctx.restore();
      draws++;
      // Portals.
      for (const f of frames) {
        ctx.save();
        if (clipped) clipTo(ctx, visibleBox(f.portal), x0, y0);
        ctx.beginPath();
        ctx.rect(f.x - x0, f.y - y0, f.w, f.h);
        ctx.clip();
        ctx.translate(f.cx - x0, f.cy - y0);
        ctx.scale(f.s, f.s);
        ctx.drawElementImage(this.#content, 0, 0, w, h);
        ctx.restore();
        draws++;
      }
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        this.#painted = false;
        this.#canvas.requestPaint();
        return;
      }
      throw err;
    }

    // One element, one geometry: give it to the copy under the pointer.
    const m = new DOMMatrix().scale(this.#unit(w));
    if (active) m.translateSelf(active.cx - x0, active.cy - y0).scaleSelf(active.s);
    else m.translateSelf(home.left - x0, home.top - y0);
    const geometry = { canvasTransform: m };
    if (clip) geometry.canvasClip = new DOMRect(...clip);
    this.#canvas.updateElementGeometry(this.#content, geometry);
    if (this.active !== (active?.portal ?? null)) {
      this.active = active?.portal ?? null;
      for (const p of this.#portals) p.toggleAttribute('active', p === this.active);
    }
    this.stats = { mode, canvas: [pw, ph], draws, frames: this.stats.frames + 1 };
  }
}

let uid = 0;

export class DomPortal extends HTMLElement {
  static observedAttributes = ['for', 'scale', 'fit'];
  static get supported() {
    return SUPPORTED;
  }

  #root;
  #box;
  #source = null;
  #retry = 0;
  #clone = null;
  #mo = null;
  uid = ++uid;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>
      :host { display: inline-block; vertical-align: top; }
      :host([fit]) { display: block; }
      :host([hidden]) { display: none; }
      #box { pointer-events: none; }
      #clone { transform-origin: 0 0; }
    </style><div id="box"></div>`;
    this.#box = this.#root.getElementById('box');
  }

  /** The <dom-portal-source> this portal mirrors (null until resolved). */
  get source() {
    return this.#source;
  }

  connectedCallback() {
    this.setAttribute('aria-hidden', 'true'); // the real element is elsewhere in the tree
    this.#resolve();
  }

  disconnectedCallback() {
    this.#source?.detach(this);
    this.#source = null;
    this.#mo?.disconnect();
    cancelAnimationFrame(this.#retry);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'for') {
      this.#source?.detach(this);
      this.#source = null;
      this.#resolve();
    } else if (this.#source?.width) this.sourceResized(this.#source.width, this.#source.height);
  }

  #target() {
    const ref = this.getAttribute('for');
    if (!ref) return null;
    const scope = this.getRootNode();
    let el = scope.getElementById?.(ref) ?? document.getElementById(ref);
    if (!el) {
      try {
        el = document.querySelector(ref);
      } catch {}
    }
    return el;
  }

  #resolve(tries = 0) {
    cancelAnimationFrame(this.#retry);
    const target = this.#target();
    if (!target) {
      // The target may not be parsed yet.
      if (tries < 120) this.#retry = requestAnimationFrame(() => this.#resolve(tries + 1));
      return;
    }
    if (!SUPPORTED) return this.#fallback(target);
    this.#source = DomPortalSource.adopt(target);
    this.#source.attach(this);
  }

  /** Called by the source when the mirrored element changes size. */
  sourceResized(w, h) {
    if (this.hasAttribute('fit')) {
      this.#box.style.width = '';
      this.#box.style.height = '';
      return;
    }
    const s = this.scale;
    this.#box.style.width = w * s + 'px';
    this.#box.style.height = h * s + 'px';
  }

  get scale() {
    const s = Number(this.getAttribute('scale'));
    return s > 0 ? s : 1;
  }

  /** Where the copy goes, in client coordinates. */
  frame(w, h) {
    const r = this.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let s = this.scale;
    let cx = r.left, cy = r.top;
    if (this.hasAttribute('fit')) {
      s = Math.min(r.width / w, r.height / h);
      cx += (r.width - w * s) / 2;
      cy += (r.height - h * s) / 2;
    }
    return { portal: this, x: r.left, y: r.top, w: r.width, h: r.height, cx, cy, s };
  }

  // No HTML-in-canvas: show a dead copy. It is inert and hidden from
  // assistive tech, so there is still only one real element.
  #fallback(target) {
    const render = () => {
      const copy = target.cloneNode(true);
      copy.removeAttribute('id');
      for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
      copy.inert = true;
      const s = this.scale;
      const wrap = document.createElement('div');
      wrap.id = 'clone';
      wrap.style.cssText = `width:${target.offsetWidth}px;transform:scale(${s})`;
      wrap.append(copy);
      this.#box.style.cssText = `width:${target.offsetWidth * s}px;height:${target.offsetHeight * s}px;overflow:hidden`;
      this.#box.replaceChildren(wrap);
      this.#clone = copy;
    };
    render();
    let pending = 0;
    this.#mo = new MutationObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(render);
    });
    this.#mo.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  }
}

/** The part of an element's box not clipped by scrolling or clipping ancestors. */
function visibleBox(el) {
  const r = el.getBoundingClientRect();
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
  for (let n = el.parentElement ?? el.getRootNode().host; n; n = n.parentElement ?? n.getRootNode().host) {
    if (!(n instanceof Element)) break;
    const cs = getComputedStyle(n);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const c = n.getBoundingClientRect();
    x0 = Math.max(x0, c.left + n.clientLeft); y0 = Math.max(y0, c.top + n.clientTop);
    x1 = Math.min(x1, c.left + n.clientLeft + n.clientWidth); y1 = Math.min(y1, c.top + n.clientTop + n.clientHeight);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

function clipTo(ctx, box, ox, oy) {
  ctx.beginPath();
  ctx.rect(box.x - ox, box.y - oy, box.w, box.h);
  ctx.clip();
}

if (!customElements.get('dom-portal-source')) customElements.define('dom-portal-source', DomPortalSource);
if (!customElements.get('dom-portal')) customElements.define('dom-portal', DomPortal);
