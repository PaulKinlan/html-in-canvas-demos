// effect-frame.js: <effect-frame effect="wave"> draws its light-DOM children through an effect.
//
//   <script type="module" src="/lib/effect-frame.js"></script>
//   <effect-frame effect="glass" style="height: 280px">
//     <form>…</form>
//   </effect-frame>
//
// The children stay in the page's own DOM and keep their styles, focus, form submission and names in
// the accessibility tree. The element's shadow root holds a drawable canvas, and inside the canvas one
// `drawable` <div> with a <slot>. The picture of that div is the picture of the slotted children, so the
// author's markup needs no attribute. One 2D context, no WebGL.
//
//   effect="none | wave | glass | melt | <a name you registered>"
//   amount="0..1"                 strength, default 1
//   EffectFrame.effects.name = (ctx, draw, frame) => again
//       draw(x = 0, y = 0)        draws the children at x, y in CSS pixels
//       frame                     { width, height, time, amount, pointer: { x, y } or null, filter(id, attrs) }
//       return true               to be called again next frame
//   element.paints                paint events so far
//   element.plain                 true after the canvas was given up (no API, or a lost context)
//
// Give the element a height, as for a canvas or an iframe (default 300px). Children taller than that
// are cut off. In a browser without the API, and after a lost context, the children show as plain HTML.

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// #region effects
// An effect draws the children one or more times. `calm` is 0 at the pointer and 1 far from it, so the
// content under the finger or the mouse is flat and readable.
const calm = (frame, x, y, radius = 90) => {
  if (!frame.pointer) return 1;
  const d = Math.hypot(x - frame.pointer.x, y - frame.pointer.y);
  return clamp((d - radius * 0.4) / radius);
};

const effects = {
  none(ctx, draw) { draw(); return false; },

  // Rows three pixels tall, each moved sideways along a travelling sine.
  wave(ctx, draw, frame) {
    const { width, height, time, amount } = frame;
    for (let y = 0; y < height; y += 3) {
      const dx = Math.sin(y / 26 + time * 2.6) * 9 * amount * calm(frame, frame.pointer?.x ?? 0, y, 70);
      ctx.save();
      ctx.beginPath(); ctx.rect(-20, y, width + 40, 3); ctx.clip();
      draw(dx, 0);
      ctx.restore();
    }
    return true;
  },

  // Glass blocks: the content is cut into square tiles and each tile is drawn enlarged about its centre,
  // with a light and a dark edge.
  glass(ctx, draw, frame) {
    const { width, height, amount } = frame, size = 46;
    for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
      const cx = x + size / 2, cy = y + size / 2, k = 1 + 0.22 * amount * calm(frame, cx, cy);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      draw();
      ctx.restore();
      const edge = 0.5 * amount * calm(frame, cx, cy);
      ctx.fillStyle = `rgb(255 255 255 / ${0.28 * edge})`; ctx.fillRect(x, y, size, 1.5); ctx.fillRect(x, y, 1.5, size);
      ctx.fillStyle = `rgb(0 0 0 / ${0.3 * edge})`; ctx.fillRect(x, y + size - 1.5, size, 1.5); ctx.fillRect(x + size - 1.5, y, 1.5, size);
    }
    return false;
  },

  // An SVG displacement filter from the element's own shadow tree, set as ctx.filter.
  melt(ctx, draw, frame) {
    const scale = 36 * frame.amount * (0.7 + 0.3 * Math.sin(frame.time * 1.3));
    ctx.filter = frame.filter('melt', { scale: scale.toFixed(1) });
    draw();
    ctx.filter = 'none';
    return true;
  },
};
// #endregion effects

// #region shadow
const TEMPLATE = `
<style>
  :host { display: block; position: relative; height: 300px; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: pan-y; }
  #content { box-sizing: border-box; width: 100%; }
  :host([plain]) { height: auto !important; overflow: visible; }
  :host([plain]) canvas { display: none; }
</style>
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <filter id="melt" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.011 0.02" numOctaves="2" seed="7" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>
<canvas content="drawable" layoutsubtree><div id="content" drawable><slot></slot></div></canvas>`;
// #endregion shadow

export class EffectFrame extends HTMLElement {
  static supported = SUPPORTED;
  static effects = effects;
  static observedAttributes = ['effect', 'amount'];

  #canvas = null; #content = null; #ctx = null;
  #pointer = null; #queued = 0; #visible = false; #retries = 0; #pending = null;
  paints = 0;
  plain = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    if (!SUPPORTED) { root.innerHTML = '<slot></slot>'; this.plain = true; return; }
    root.innerHTML = TEMPLATE;
    this.#canvas = root.querySelector('canvas');
    this.#content = root.getElementById('content');
    this.#ctx = this.#canvas.getContext('2d');
    if (!this.#ctx) { queueMicrotask(() => this.#toPlain('The canvas gave no 2D context.')); return; }

    // #region paint
    this.#canvas.addEventListener('paint', () => {
      const canvas = this.#canvas, ctx = this.#ctx, content = this.#content;
      if (this.plain || ctx.isContextLost?.() || !canvas.clientWidth) return;
      this.paints++;
      const dpr = canvas.width / canvas.clientWidth || 1;
      ctx.reset();
      ctx.scale(dpr, dpr);
      const w = content.offsetWidth, h = content.offsetHeight;
      let missed = false;
      // Every draw passes a width and height. An element has no picture before its first paint.
      const draw = (x = 0, y = 0) => { try { ctx.drawElementImage(content, x, y, w, h); } catch { missed = true; } };
      const effect = effects[this.getAttribute('effect')] ?? effects.none;
      const amount = this.hasAttribute('amount') ? clamp(Number(this.getAttribute('amount')) || 0) : 1;
      this.#pending = null;
      let again = effect(ctx, draw, {
        width: w, height: h, time: performance.now() / 1000, amount, pointer: this.#pointer,
        // The filter's attributes are changed after this paint, not during it.
        filter: (id, attrs) => { this.#pending = { id, attrs }; return `url(#${id})`; },
      });
      // Input goes to the flat position, whatever the last draw's transform was: a draw inside an
      // empty clip moves the hit region and adds no pixels.
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); draw(); ctx.restore();
      if (missed && this.#retries++ < 60) again = true; else if (!missed) this.#retries = 0;
      if ((again || this.#pending) && this.#visible && !this.#queued) {
        this.#queued = requestAnimationFrame(() => {
          this.#queued = 0;
          if (this.#pending) {
            const node = this.shadowRoot.getElementById(this.#pending.id)?.lastElementChild;
            for (const [k, v] of Object.entries(this.#pending.attrs)) node?.setAttribute(k, v);
          }
          if (again) this.request();
        });
      }
    });
    // #endregion paint

    // #region lost
    // A lost context: show the children as plain HTML and do not draw again.
    this.#canvas.addEventListener('contextlost', () => this.#toPlain('The canvas lost its drawing context.'));
    // #endregion lost

    const move = (e) => {
      const r = this.#canvas.getBoundingClientRect();
      this.#pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.request();
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerdown', move);
    this.addEventListener('pointerleave', () => { this.#pointer = null; this.request(); });

    new ResizeObserver(([e]) => {
      const canvas = this.#canvas;
      const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: Math.round(canvas.clientWidth * devicePixelRatio), blockSize: Math.round(canvas.clientHeight * devicePixelRatio) };
      if (!box.inlineSize || !box.blockSize) return;
      if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
      if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
      this.request();
    }).observe(this.#canvas);
    new IntersectionObserver(([e]) => { this.#visible = e.isIntersecting; if (this.#visible) this.request(); }).observe(this);
  }

  request() { if (!this.plain) this.#canvas?.requestPaint?.(); }
  attributeChangedCallback() { this.request(); }
  connectedCallback() { this.request(); }
  disconnectedCallback() { cancelAnimationFrame(this.#queued); this.#queued = 0; }

  #toPlain(why) {
    if (this.plain) return;
    this.plain = true;
    cancelAnimationFrame(this.#queued);
    this.shadowRoot.append(this.#content);        // out of the canvas, still holding the slot
    this.toggleAttribute('plain', true);
    this.dispatchEvent(new CustomEvent('effect-frame-plain', { bubbles: true, composed: true, detail: { why } }));
  }
}

if (!customElements.get('effect-frame')) customElements.define('effect-frame', EffectFrame);
