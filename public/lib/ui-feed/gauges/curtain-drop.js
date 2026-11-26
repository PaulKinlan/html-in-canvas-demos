// <curtain-drop>: an <input type="number"> shown as a pair of curtains of that length.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, spring, TAU } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', 'Times New Roman', serif";

// A number field that can be typed in, a button either side, and a value kept to the step between min and max.
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

// #region curtain-drop
// The number is the drop of a pair of curtains in inches, from the pole to the hem. The floor is 97 inches
// under the pole, so the note says how far the hem is from it, and past 97 the cloth lies on the floor. The
// hem is on a spring: the curtains overshoot a new length and their folds sway until they hang still.
export class CurtainDrop extends NumberControl {
  static size = [360, 384];
  static defaults = { min: 48, max: 106, step: 1, value: 96 };
  static html = `<input type="number" class="value" inputmode="numeric" aria-label="Drop, in inches"><button type="button" class="dec" aria-label="One inch shorter"></button><button type="button" class="inc" aria-label="One inch longer"></button>
    <output class="note"></output><span class="cloth"><slot>Linen</slot></span><output class="detail"></output><output class="price"></output>`;
  static css = `
    .value { width: 120px; height: 84px; opacity: 0; font-size: 40px; touch-action: manipulation; }
    .dec, .inc { width: 44px; height: 44px; opacity: 0; border-radius: 50%; touch-action: manipulation; }
    .note { width: 118px; font: italic 400 12.5px/1.2 ${SERIF}; color: #222; text-align: right; white-space: nowrap; }
    .cloth { width: 220px; font: 400 9px/1.2 ${SERIF}; letter-spacing: 0.24em; text-transform: uppercase; color: #333; white-space: nowrap; }
    .detail { width: 232px; font: 400 12px/1.2 ${SERIF}; color: #222; white-space: nowrap; }
    .price { width: 110px; font: 400 21px/1 ${SERIF}; color: #111; text-align: right; font-variant-numeric: lining-nums; }`;
  static POLE = 62; static FLOOR = 328; static FLOOR_IN = 97;

  setup() {
    this.pole = Number(this.getAttribute('pole') ?? 72); this.rate = Number(this.getAttribute('price') ?? 68);
    this.len = { x: Number(this.getAttribute('value') ?? 96), v: 0 }; this.sway = { x: 0, v: 0 };
  }
  // Three widths of cloth, each the drop and ten inches for the hems.
  get yards() { return Math.round(((3 * (this.v + 10)) / 36) * 100) / 100; }
  get cost() { return (this.yards * this.rate).toFixed(2); }
  changed() {
    const gap = CurtainDrop.FLOOR_IN - this.v;
    this.$('.note').textContent = gap > 0 ? `${gap} in above the floor` : gap < 0 ? `${-gap} in on the floor` : 'to the floor';
    this.$('.detail').textContent = `Pair for a ${this.pole} in pole, ${this.yards.toFixed(2)} yd at $${this.rate} a yard`;
    this.$('.price').textContent = `$${this.cost}`;
  }

  draw(ctx, w, h) {
    const { POLE, FLOOR, FLOOR_IN } = CurtainDrop, S = (FLOOR - POLE) / FLOOR_IN;
    const was = this.len.v;
    let live = spring(this.len, this.v, this.dt, 46, 7.5);
    this.sway.v += (this.len.v - was) * 0.3;                       // a change of speed sets the folds swinging
    live = spring(this.sway, 0, this.dt, 34, 4.6) || live;
    ctx.fillStyle = '#f3f1ec'; ctx.fillRect(0, 0, w, h);
    // the number and its buttons
    ctx.fillStyle = '#333'; ctx.font = `400 8.5px ${SERIF}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('D R O P', 24, 30); ctx.textAlign = 'right'; ctx.fillText('I N', 138, 30);
    const text = this.field.matches(':focus') && this.field.value !== '' ? this.field.value : String(this.v);
    ctx.fillStyle = '#111'; ctx.font = `400 74px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, 26, 112);
    ctx.strokeStyle = this.field.matches(':focus') ? '#111' : '#b9b5ac'; ctx.lineWidth = this.field.matches(':focus') ? 1.4 : 0.8; ctx.beginPath(); ctx.moveTo(24, 126); ctx.lineTo(140, 126); ctx.stroke();
    hit(ctx, this.field, 22, 40, 120, 84);
    for (const [el, bx, sign] of [[this.$('.dec'), 40, -1], [this.$('.inc'), 78, 1]]) {
      ctx.globalAlpha = el.disabled ? 0.3 : 1; ctx.strokeStyle = '#555'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(bx, 156, 14, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx - 5, 156); ctx.lineTo(bx + 5, 156); if (sign > 0) { ctx.moveTo(bx, 151); ctx.lineTo(bx, 161); } ctx.stroke();
      ctx.globalAlpha = 1;
      if (el.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, 156, 18, 0, TAU); ctx.stroke(); }
      hit(ctx, el, bx - 22, 134, 44, 44);
    }
    ctx.fillStyle = '#444'; ctx.font = `400 8.5px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${this.min}  –  ${this.max}`, 102, 156);
    // window, pole, floor
    ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8;
    ctx.strokeRect(190, POLE + 22, 110, 132); ctx.strokeRect(194, POLE + 26, 49, 124); ctx.strokeRect(247, POLE + 26, 49, 124); ctx.strokeRect(186, POLE + 154, 118, 5);
    ctx.beginPath(); ctx.moveTo(150, POLE); ctx.lineTo(340, POLE); ctx.moveTo(24, FLOOR); ctx.lineTo(340, FLOOR); ctx.stroke();
    ctx.fillStyle = '#f3f1ec'; for (const x of [150, 340]) { ctx.beginPath(); ctx.arc(x, POLE, 2.6, 0, TAU); ctx.fill(); ctx.stroke(); }
    // the curtains: seven folds each, darker in the valleys, with the hem lower at the back of each fold
    const hem = POLE + this.len.x * S;
    for (const [x0, dir] of [[154, 1], [296, -1]]) {
      const W = 44, N = 7, over = Math.max(0, hem - FLOOR);
      if (over > 0) {      // cloth on the floor
        ctx.fillStyle = '#17171b';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(x0 + W / 2 + (i - 1.5) * (6 + over * 0.25) * dir, FLOOR - 1 - Math.min(5, over * 0.2) * (i % 2), 14 + over * 0.5, 2.5 + Math.min(6, over * 0.35), 0, 0, TAU); ctx.fill(); }
      }
      for (let i = 0; i < N; i++) {
        const fx = x0 + (i * W) / N, fw = W / N + 0.6, depth = (hem - POLE) / 280;
        const lean = this.sway.x * depth * (0.6 + 0.4 * Math.sin(i * 1.7)) * dir;       // sideways at the hem
        const bottom = Math.min(FLOOR + 1, hem + Math.sin(i * 2.4 + 0.5) * 1.6 + Math.abs(this.sway.x) * 0.25 * Math.sin(i * 1.3));
        const g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
        g.addColorStop(0, '#08080a'); g.addColorStop(0.45, i % 2 ? '#2c2c33' : '#22222a'); g.addColorStop(1, '#0b0b0d');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(fx, POLE + 3); ctx.lineTo(fx + fw, POLE + 3);
        ctx.quadraticCurveTo(fx + fw + lean * 0.3, (POLE + bottom) / 2, fx + fw + lean, bottom); ctx.lineTo(fx + lean, bottom + (i % 2 ? 0.8 : -0.8));
        ctx.quadraticCurveTo(fx + lean * 0.3, (POLE + bottom) / 2, fx, POLE + 3); ctx.fill();
      }
      // the weave: fine lighter threads
      ctx.save(); ctx.globalAlpha = 0.1; ctx.strokeStyle = '#cfcfe0'; ctx.lineWidth = 0.3; ctx.beginPath();
      for (let i = 0; i < 22; i++) { const tx = x0 + rnd(i + x0) * W; ctx.moveTo(tx, POLE + 4); ctx.lineTo(tx + this.sway.x * 0.5 * dir, Math.min(FLOOR, hem) - 2); }
      ctx.stroke(); ctx.restore();
    }
    // the note, with a mark at the height of the hem
    const mark = Math.min(FLOOR, hem);
    ctx.strokeStyle = '#d23b2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(142, mark); ctx.lineTo(150, mark); ctx.stroke();
    put(ctx, this.$('.note'), 20, FLOOR - 20);
    put(ctx, this.$('.cloth'), 24, FLOOR + 14); put(ctx, this.$('.detail'), 24, FLOOR + 30); put(ctx, this.$('.price'), 230, FLOOR + 20);
    return live;
  }
}
customElements.define('curtain-drop', CurtainDrop);
// #endregion curtain-drop
