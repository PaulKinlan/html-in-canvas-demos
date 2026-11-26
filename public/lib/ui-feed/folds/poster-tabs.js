// <poster-tabs>: kinetic poster with radio tabs and an <output> stretched to fill the poster box.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, easeOut, spring, reduced } from '../kit.js';
import { focusRing } from '../fold.js';

const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";
const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : Math.round(n).toLocaleString('en-US'));

export class PosterTabs extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOX = { x: 20, y: 86, w: 320, h: 194 };      // the figure fills this
  static TAB = { x: 20, y: 20, w: 320, h: 48 };
  static css = `
    input { opacity: 0; margin: 0; touch-action: manipulation; }
    label { font: 300 36px/48px ${SANS}; color: #fff; white-space: nowrap; cursor: pointer; }
    input:checked + label { font-weight: 900; color: #1f2ee6; }
    output { font: 900 240px/1 Impact, Haettenschweiler, 'Arial Narrow', ${COND}; font-stretch: condensed; color: #fff; white-space: nowrap; }
    .unit, .delta { margin: 0; font: 300 34px/40px ${SANS}; color: #fff; white-space: nowrap; }
    .delta { color: #d6ff3c; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-count', 'data-change', 'unit', 'label'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.show(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }
  // #region poster-tabs
  build() {
    const items = this.items = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Period';
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); box.append(el); return el; };
    this.radios = []; this.labels = [];
    items.forEach((o, i) => { this.radios.push(add(`<input type="radio" name="period" id="p${i}" value="${esc(o.value)}">`)); this.labels.push(add(`<label for="p${i}">${esc(o.label)}</label>`)); });
    // Two outputs: the one that shows the figure now, and the one that showed the figure before it.
    this.outs = [add(`<output for="${items.map((_, i) => `p${i}`).join(' ')}"></output>`), add('<output inert></output>')];
    this.unit = add(`<p class="unit">${esc(this.getAttribute('unit') ?? '')}</p>`);
    this.delta = add('<p class="delta"><data></data></p>');
    // A tab is as wide as its name needs, as a share of the strip. The names are drawn at 0.62 of their width.
    const need = this.labels.map((l) => l.offsetWidth * 0.62 + 26), all = need.reduce((s, v) => s + v, 0) || 1;
    let x = PosterTabs.TAB.x;
    this.slots = need.map((v) => { const s = { x, w: (v / all) * PosterTabs.TAB.w }; x += s.w; return s; });
    const at = Math.max(0, items.findIndex((o) => o.value === was), was ? -1 : items.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.mark = { x: { x: this.slots[at]?.x ?? 0, v: 0 }, w: { x: this.slots[at]?.w ?? 0, v: 0 } };
    this.now = 0; this.turn = 1;                        // which output is current, and how far the change has got
    this.show(true);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.show(); }
  show(first = false) {
    const o = this.items[this.index]; if (!o) return;
    const text = count(Number(o.data.count ?? 0)), change = Number(o.data.change ?? 0);
    if (!first && this.outs[this.now].value === text) return;
    if (!first) { this.now = 1 - this.now; this.turn = reduced() ? 1 : 0; }
    const cur = this.outs[this.now], old = this.outs[1 - this.now];
    cur.value = text; cur.inert = false; old.inert = true;
    const d = this.delta.firstElementChild; d.value = String(change); d.textContent = `${change > 0 ? '+' : ''}${change}%`;
    this.setValue(this.value); this.request();
  }
  // #endregion poster-tabs

  // #region poster-fill
  // Where the ink of an output's text is inside the element: from the left edge of the first glyph to the
  // right edge of the last, and from the top of a figure to the baseline. A comma hangs below that.
  ink(out) {
    const key = `${out.value}|${out.offsetWidth}`;
    if (out.inkKey === key) return out.inkBox;
    measure.font = getComputedStyle(out).font;
    const m = measure.measureText(out.value), cap = measure.measureText('0').actualBoundingBoxAscent, size = out.offsetHeight;
    const baseline = (size - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    out.inkKey = key;
    return out.inkBox = { x: -m.actualBoundingBoxLeft, y: baseline - cap, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h: cap };
  }
  // Draw the output so that its ink fills the rectangle x, y, w, h. The picture is stretched both ways.
  fill(ctx, out, x, y, w, h) {
    if (h < 0.5 || !out.value) return;
    const k = this.ink(out), sx = w / k.w, sy = h / k.h;
    put(ctx, out, x - k.x * sx, y - k.y * sy, out.offsetWidth * sx, out.offsetHeight * sy);
  }
  // #endregion poster-fill

  draw(ctx, w, h) {
    const { BOX, TAB } = PosterTabs, slot = this.slots[this.index] ?? { x: 0, w: 0 };
    let moving = spring(this.mark.x, slot.x, this.dt, 230, 24);
    moving = spring(this.mark.w, slot.w, this.dt, 230, 24) || moving;
    if (this.turn < 1) { this.turn = Math.min(1, this.turn + this.dt / 0.42); moving = true; }
    const p = easeOut(this.turn);

    ctx.fillStyle = '#1f2ee6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d6ff3c'; ctx.fillRect(this.mark.x.x, TAB.y, this.mark.w.x, TAB.h);
    this.labels.forEach((l, i) => { const s = this.slots[i], lw = l.offsetWidth * 0.62; put(ctx, l, s.x + (s.w - lw) / 2, TAB.y, lw, TAB.h); });
    ctx.fillStyle = '#fff'; ctx.fillRect(TAB.x, TAB.y + TAB.h, TAB.w, 3);

    // The old figure is pressed flat against the top of the box while the new one grows up from the bottom.
    const cur = this.outs[this.now], old = this.outs[1 - this.now], split = BOX.h * (1 - p);
    if (p < 1) { ctx.save(); ctx.globalAlpha = 1 - p * 0.3; this.fill(ctx, old, BOX.x, BOX.y, BOX.w, split - 3); ctx.restore(); }
    this.fill(ctx, cur, BOX.x, BOX.y + split, BOX.w, BOX.h - split);
    // The outputs are wider than the canvas. Their hit regions are taken back off the tabs by drawing those last.
    const uw = this.unit.offsetWidth * 0.62, dw = this.delta.offsetWidth * 0.62;
    put(ctx, this.unit, 20, 308, uw, 40);
    put(ctx, this.delta, 340 - dw, 308, dw, 40);
    this.radios.forEach((r, i) => {
      const s = this.slots[i];
      if (r.matches(':focus-visible')) focusRing(ctx, s.x + 3, TAB.y + 3, s.w - 6, TAB.h - 6, r.checked ? '#1f2ee6' : '#fff');
      hit(ctx, r, s.x, TAB.y, s.w, TAB.h);
    });
    return moving;
  }
}
customElements.define('poster-tabs', PosterTabs);
