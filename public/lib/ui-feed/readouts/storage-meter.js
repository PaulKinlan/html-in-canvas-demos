// <storage-meter>: a <meter> for each <option>, one for the total, and a button to clear marked items.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, spring } from '../kit.js';

const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";

// #region storage-meter
// A <meter> for each <option>, one more for the total, and a button for each option marked data-clear.
// Clearing does not jump: each category's amount is on a spring, the total is their sum, and the strip of
// marks goes out one mark at a time as the total falls.
export class StorageMeter extends FeedControl {
  static size = [360, 384];
  static html = `<meter class="total" min="0" aria-label="Storage used"></meter>`;
  static css = `
    .total { width: 320px; height: 34px; opacity: 0; }
    .row { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 320px; height: 28px; border-top: 1px solid #2c2c2c; color: #fff; font: 500 12px/1 ${SANS}; }
    .row span { width: 96px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row output { width: 58px; text-align: right; font-variant-numeric: tabular-nums; } .row output small { color: #9a9a9a; font-size: 9px; margin-left: 3px; }
    .row meter { flex: 1; height: 3px; appearance: none; -webkit-appearance: none; background: #3a3a3a; border: 0; }
    .row meter::-webkit-meter-bar { background: #3a3a3a; border: 0; border-radius: 0; height: 3px; }
    .row meter::-webkit-meter-optimum-value { background: #fff; border-radius: 0; }
    .clear { box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; width: 320px; height: 34px; padding: 0 12px; background: #000; color: #fff; border: 1px solid #fff; border-radius: 0;
      font: 600 9.5px/1 ${SANS}; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; touch-action: manipulation; }
    .clear[aria-pressed="true"] { background: #f4e53a; color: #000; border-color: #f4e53a; }`;

  ready() {
    this.capacity = Number(this.getAttribute('capacity') ?? 128);
    this.total = this.$('.total'); this.total.max = this.capacity;
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  build() {
    for (const el of this.$$('.row, .clear')) el.remove();
    const make = (tag, cls, html) => { const el = Object.assign(document.createElement(tag), { className: cls, innerHTML: html }); el.setAttribute('drawable', ''); this.canvas.append(el); return el; };
    const was = new Map((this.items ?? []).map((it) => [it.name, it]));
    this.items = options(this).map((o) => {
      const size = Number(o.value), old = was.get(o.label);
      const row = make('div', 'row', `<span>${esc(o.label)}</span><meter min="0" max="${Math.round(this.capacity * 0.36)}" aria-label="${esc(o.label)}"></meter><output></output>`);
      const it = { name: o.label, size, cleared: old?.cleared ?? false, s: old?.s ?? { x: size, v: 0 }, row, meter: row.querySelector('meter'), out: row.querySelector('output'), shown: null };
      if ('clear' in o.data) {
        it.button = make('button', 'clear', ''); it.button.type = 'button';
        it.button.addEventListener('click', () => { it.cleared = !it.cleared; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
      }
      return it;
    });
    this.sync();
  }
  // Gigabytes in use once everything has settled.
  get value() { return this.items.reduce((a, it) => a + (it.cleared ? 0 : it.size), 0).toFixed(1); }
  get used() { return this.items.reduce((a, it) => a + Math.max(0, it.s.x), 0); }
  sync() {
    for (const it of this.items) if (it.button) {
      it.button.setAttribute('aria-pressed', String(it.cleared));
      it.button.innerHTML = `<span>${it.cleared ? 'Put back' : 'Clear'} ${esc(it.name)}</span><span>${it.cleared ? '+' : '−'} ${it.size.toFixed(1)} GB</span>`;
    }
    this.setValue(this.value);
    this.request();
  }

  draw(ctx, w, h) {
    let live = false;
    for (const it of this.items) {
      if (spring(it.s, it.cleared ? 0 : it.size, this.dt, 30, 11)) live = true;
      const text = Math.max(0, it.s.x).toFixed(1);
      if (it.shown !== text) { it.shown = text; it.meter.value = Number(text); it.out.innerHTML = `${text}<small>GB</small>`; }
    }
    const used = this.used, free = this.capacity - used;
    if (this.total.value !== Number(used.toFixed(1))) { this.total.value = Number(used.toFixed(1)); this.total.setAttribute('aria-valuetext', `${used.toFixed(1)} of ${this.capacity} gigabytes`); }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a9a9a9'; ctx.font = `500 8px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('S T O R A G E   U S E D', 20, 20);
    ctx.textAlign = 'right'; ctx.fillText(`C A P A C I T Y  ·  ${this.capacity}  G B`, w - 20, 20); ctx.fillText('F R E E', w - 20, 52);
    ctx.fillStyle = '#fff'; ctx.font = `300 54px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(used.toFixed(1), 18, 78);
    const tw = ctx.measureText(used.toFixed(1)).width;
    ctx.fillStyle = '#9a9a9a'; ctx.font = `400 15px ${SANS}`; ctx.fillText('GB', 24 + tw, 78);
    ctx.fillStyle = '#fff'; ctx.font = `400 16px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(`${free.toFixed(1)} GB`, w - 20, 76);
    // the strip: 80 marks, lit up to the total, the last one in part
    const N = 80, lit = (used / this.capacity) * N;
    for (let i = 0; i < N; i++) {
      const a = clamp(lit - i);
      ctx.fillStyle = a >= 1 ? '#f4e53a' : a > 0 ? `rgb(${Math.round(lerp(58, 244, a))},${Math.round(lerp(58, 229, a))},58)` : '#3a3a3a';
      ctx.fillRect(20 + i * 4, 94, 2.4, 34);
    }
    hit(ctx, this.total, 20, 94, 320, 34);
    ctx.fillStyle = '#9a9a9a'; ctx.font = `500 7.5px ${SANS}`; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'; ctx.fillText(String((this.capacity / 4) * i), 20 + i * 80, 140); }
    let y = 156;
    for (const it of this.items) { put(ctx, it.row, 20, y); y += 28; }
    ctx.fillStyle = '#2c2c2c'; ctx.fillRect(20, y, 320, 1);
    y += 14;
    for (const it of this.items) if (it.button) {
      put(ctx, it.button, 20, y);
      if (it.button.matches(':focus-visible')) { ctx.strokeStyle = '#7fb4ff'; ctx.lineWidth = 2; ctx.strokeRect(17, y - 3, 326, 40); }
      y += 42;
    }
    return live;
  }
}
customElements.define('storage-meter', StorageMeter);
// #endregion storage-meter
