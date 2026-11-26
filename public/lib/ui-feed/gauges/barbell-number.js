// <barbell-number>: an <input type="number"> shown as the plates loaded on one end of a bar.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, spring, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const HAND = "'Bradley Hand', 'Segoe Print', 'Chalkboard SE', 'Comic Sans MS', cursive";

// #region number-control
// The two number fields below share this: a field that can be typed in, a button either side, and a value
// kept to the step between min and max.
class NumberControl extends FeedControl {
  static observedAttributes = ['value'];
  ready() {
    this.field = this.$('.value');
    const num = (name, d) => Number(this.getAttribute(name) ?? d), D = this.constructor.defaults;
    this.min = num('min', D.min); this.max = num('max', D.max); this.step = num('step', D.step);
    Object.assign(this.field, { min: this.min, max: this.max, step: this.step });
    this.v = this.fit(num('value', D.value));
    this.field.addEventListener('input', () => { if (Number.isFinite(this.field.valueAsNumber)) this.set(this.field.valueAsNumber, false, true); });
    this.field.addEventListener('change', () => this.set(this.v, true));
    this.$('.dec').addEventListener('click', () => this.set(this.v - this.step, true));
    this.$('.inc').addEventListener('click', () => this.set(this.v + this.step, true));
    this.setup?.();
    this.set(this.v, false);
  }
  fit(v) { return clamp(Math.round((Number(v) || 0) / this.step) * this.step, this.min, this.max); }
  attributeChangedCallback(_, __, v) { if (this.field && v !== null) this.value = v; }
  get value() { return String(this.v); }
  set value(v) { this.set(v, false); }
  set(v, done, typing = false) {
    v = this.fit(v);
    const changed = v !== this.v;
    this.v = v;
    this.setValue(String(v));
    if (!typing) this.field.value = v;
    this.$('.dec').disabled = v <= this.min; this.$('.inc').disabled = v >= this.max;
    this.changed?.();
    if (changed) this.dispatchEvent(new Event('input', { bubbles: true }));
    if (done) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }
}
// #endregion number-control

// #region barbell-number
// The number is the weight on the bar. The control works out the plates for one end, heaviest first, and
// slides each one on. A plate that is no longer needed slides off. The bar dips when a plate lands.
const PLATES = [[45, 22, 150], [35, 20, 130], [25, 18, 108], [10, 12, 80], [5, 10, 58], [2.5, 8, 46]];   // pounds, thickness, height
export function platesFor(total, bar = 45) {
  let side = Math.max(0, (total - bar) / 2); const out = [];
  for (const [lb] of PLATES) while (side >= lb - 1e-9) { out.push(lb); side -= lb; }
  return out;
}
let hatchTile = null;
const hatch = (ctx) => {
  if (!hatchTile) {
    hatchTile = document.createElement('canvas'); hatchTile.width = hatchTile.height = 24;
    const g = hatchTile.getContext('2d'); g.strokeStyle = '#161616'; g.lineWidth = 1.1;
    for (let i = -24; i < 48; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 24, 24); g.moveTo(i + 24, 0); g.lineTo(i, 24); g.stroke(); }
  }
  const p = ctx.createPattern(hatchTile, 'repeat'); p.setTransform(new DOMMatrix().scale(0.25));
  return p;
};
// A line drawn twice, a little apart, the way a pen goes over a pencil line.
const sketch = (ctx, path, seed = 0) => {
  for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate((rnd(seed + i) - 0.5) * 1.1, (rnd(seed + i + 9) - 0.5) * 1.1); ctx.rotate((rnd(seed + i + 4) - 0.5) * 0.008); path(); ctx.stroke(); ctx.restore(); }
};

export class BarbellNumber extends NumberControl {
  static size = [360, 372];
  static defaults = { min: 45, max: 585, step: 5, value: 135 };
  static html = `<span class="title"><slot>Lift</slot></span><output class="side"></output>
    <input type="number" class="value" inputmode="numeric" aria-label="Weight on the bar, in pounds"><button type="button" class="dec" aria-label="Less"></button><button type="button" class="inc" aria-label="More"></button>`;
  static css = `
    .title { width: 300px; font: 600 21px/1.2 ${HAND}; color: #111; letter-spacing: 0.03em; }
    .side { width: 84px; font: 500 15px/1.25 ${HAND}; color: #111; text-align: right; }
    .side b { display: block; font-weight: 500; font-size: 13px; margin-bottom: 4px; } .side i { display: block; font-style: normal; padding-right: 18px; }
    .side u { display: block; text-decoration: none; border-top: 1.5px solid #111; margin-top: 3px; padding: 2px 18px 0 0; } .side small { display: block; font-size: 12.5px; margin-top: 4px; white-space: nowrap; }
    .value { width: 190px; height: 96px; opacity: 0; font-size: 40px; text-align: center; touch-action: manipulation; }
    .dec, .inc { width: 52px; height: 52px; opacity: 0; border-radius: 50%; touch-action: manipulation; }`;
  static BAR = 132;

  setup() { this.bar = Number(this.getAttribute('bar') ?? 45); this.on = []; this.off = []; this.sag = { x: 0, v: 0 }; }
  changed() {
    const want = platesFor(this.v, this.bar);
    let same = 0;
    while (same < want.length && same < this.on.length && this.on[same].lb === want[same]) same++;
    for (const p of this.on.splice(same)) { p.leaving = true; this.off.push(p); }
    for (const lb of want.slice(same)) this.on.push({ lb, s: { x: reduced() ? 1 : 0, v: 0 }, seated: false });
    const side = want.reduce((a, b) => a + b, 0);
    this.$('.side').innerHTML = `<b>each side</b>${want.map((lb) => `<i>${lb}</i>`).join('') || '<i>none</i>'}<u>${side}</u><small>× 2, + ${this.bar} bar</small>`;
  }

  draw(ctx, w, h) {
    const Y = BarbellNumber.BAR;
    let live = false;
    // dotted paper
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40,50,80,0.28)';
    for (let y = 10; y < h; y += 14) for (let x = 10; x < w; x += 14) ctx.fillRect(x, y, 1, 1);
    put(ctx, this.$('.title'), 18, 14);
    // the load, and the dip of the bar under it
    const load = this.on.reduce((a, p) => a + p.lb * clamp(p.s.x), 0);
    live = spring(this.sag, load * 0.016, this.dt, 240, 9) || live;
    ctx.save(); ctx.translate(0, Y); ctx.rotate(Math.atan2(this.sag.x, 250)); ctx.translate(0, -Y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    const ink = hatch(ctx);
    // shaft with knurling, collar, sleeve
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(-4, Y - 3.5, 80, 7); sketch(ctx, () => { ctx.beginPath(); ctx.rect(-4, Y - 3.5, 80, 7); }, 1);
    ctx.fillStyle = ink; ctx.fillRect(12, Y - 3.5, 46, 7);
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(84, Y - 7, 166, 14); sketch(ctx, () => { ctx.beginPath(); rr(ctx, 84, Y - 7, 166, 14, 3); }, 2);
    ctx.fillRect(74, Y - 15, 8, 30); sketch(ctx, () => { rr(ctx, 74, Y - 15, 8, 30, 2); }, 3);
    // plates: the ones sliding off first, then the ones on the sleeve from the collar outward
    const plate = (p, x, seed) => {
      const [, t, ph] = PLATES.find(([lb]) => lb === p.lb);
      ctx.fillStyle = '#fbfaf7'; rr(ctx, x, Y - ph / 2, t, ph, 4); ctx.fill();
      ctx.fillStyle = ink; rr(ctx, x, Y - ph / 2, t, ph, 4); ctx.fill();
      sketch(ctx, () => rr(ctx, x, Y - ph / 2, t, ph, 4), seed);
      return t + 1.5;
    };
    this.off = this.off.filter((p) => {
      const moving = spring(p.s, -0.6, this.dt, 60, 13);
      if (p.s.x < -0.45 || !moving) return false;
      live = true;
      ctx.save(); ctx.globalAlpha = clamp(p.s.x * 2.5 + 1.1); plate(p, lerp(262, p.at ?? 90, clamp(p.s.x)), p.lb * 3); ctx.restore();
      return true;
    });
    let x = 84;
    this.on.forEach((p, i) => {
      if (spring(p.s, 1, this.dt, 110, 15)) live = true;
      if (!p.seated && p.s.x > 0.97) { p.seated = true; this.sag.v += p.lb * 0.3; live = true; }     // the plate lands
      p.at = x;
      ctx.save(); ctx.globalAlpha = clamp(p.s.x * 4);
      x += plate(p, lerp(262, x, clamp(p.s.x, 0, 1.02)), i * 7 + p.lb);
      ctx.restore();
    });
    // the spring collar outside the last plate
    const cx = Math.max(x + 1, 88);
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(cx, Y - 11, 6, 22); sketch(ctx, () => { rr(ctx, cx, Y - 11, 6, 22, 2); }, 5);
    sketch(ctx, () => { ctx.beginPath(); ctx.moveTo(cx + 3, Y - 11); ctx.lineTo(cx + 8, Y - 22); }, 6);
    ctx.restore();
    put(ctx, this.$('.side'), 268, 56);
    // the number: heavy figures filled with pen hatching
    const text = this.field.matches(':focus') && this.field.value !== '' ? this.field.value : String(this.v);
    ctx.font = `900 82px 'Arial Black', 'Helvetica Neue', Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fbfaf7'; ctx.fillText(text, 172, 330);
    ctx.fillStyle = hatch(ctx); ctx.fillText(text, 172, 330);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    sketch(ctx, () => { ctx.strokeText(text, 172, 330); ctx.beginPath(); }, 11);
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = '#111'; ctx.font = `600 22px ${HAND}`; ctx.textAlign = 'left'; ctx.fillText('lb', 172 + tw / 2 + 8, 330);
    if (this.field.matches(':focus')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, 172 - tw / 2 - 8, 256, tw + 16, 84, 6); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.field, 77, 250, 190, 96);
    // minus and plus, drawn by hand
    for (const [el, bx, sign] of [[this.$('.dec'), 36, -1], [this.$('.inc'), 324, 1]]) {
      ctx.globalAlpha = el.disabled ? 0.3 : 1; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6;
      sketch(ctx, () => { ctx.beginPath(); ctx.arc(bx, 300, 17, 0.2, TAU + 0.5); }, 20 + sign);
      ctx.beginPath(); ctx.moveTo(bx - 8, 300); ctx.lineTo(bx + 8, 300.6); if (sign > 0) { ctx.moveTo(bx + 0.4, 292); ctx.lineTo(bx, 308); } ctx.stroke();
      ctx.globalAlpha = 1;
      if (el.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, 300, 23, 0, TAU); ctx.stroke(); }
      hit(ctx, el, bx - 26, 274, 52, 52);
    }
    return live;
  }
}
customElements.define('barbell-number', BarbellNumber);
// #endregion barbell-number
