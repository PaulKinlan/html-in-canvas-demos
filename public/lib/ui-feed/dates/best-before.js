// <best-before>: three numeric text fields for month, day and year printed in inkjet dots.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, clamp, lerp, easeOut, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const iso = (dt) => dt.toISOString().slice(0, 10);

// #region inkjet-font
// Five by seven dots for each character a can code needs.
const GLYPHS = {
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111',
  3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110',
  9: '01110100011000101111000010001001100', L: '10000100001000010000100001000011111', ':': '00000011000110000000011000110000000',
};
// The dots of a string, with a small wander for each so that the line looks sprayed, not drawn.
function dots(text, seed = 0) {
  const out = [];
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch]; if (!g) return;
    for (let k = 0; k < 35; k++) if (g[k] === '1') { const c = k % 5, r = Math.floor(k / 5), s = seed + i * 53 + k; out.push({ i, c, r, jx: (rnd(s) - 0.5) * 0.28, jy: (rnd(s + 7) - 0.5) * 0.28, size: 0.8 + rnd(s + 3) * 0.35 }); }
  });
  return out;
}
// Draw dots for each character at (x, y) with `pitch` between dots. born(i) is when character i was printed.
function inkjet(ctx, text, x, y, pitch, now, born = () => 0, seed = 0, ink = '#141418') {
  let moving = false;
  const step = pitch * 6.2;
  ctx.fillStyle = ink;
  for (const d of dots(text, seed)) {
    const t0 = born(d.i) + d.c * 16 + rnd(d.r + d.c * 7 + seed) * 20, age = reduced() || !born(d.i) ? 1 : clamp((now - t0) / 110);
    if (age < 1) moving = true;
    if (age <= 0) continue;
    const r = pitch * 0.44 * d.size * lerp(1.7, 1, easeOut(age));
    ctx.globalAlpha = clamp(age * 2) * (0.82 + d.size * 0.12);
    ctx.beginPath(); ctx.arc(x + d.i * step + (d.c + 0.5 + d.jx) * pitch, y + (d.r + 0.5 + d.jy) * pitch, r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return moving;
}
// #endregion inkjet-font

function drawCan(g) {
  // the printed band at the top, and brushed aluminium below it
  const blue = g.createLinearGradient(0, 0, 360, 120); blue.addColorStop(0, '#1638c8'); blue.addColorStop(0.55, '#2a4fe6'); blue.addColorStop(1, '#1131b4');
  g.fillStyle = blue; g.fillRect(0, 0, 360, 120);
  const metal = g.createLinearGradient(0, 120, 0, 360); metal.addColorStop(0, '#9fa4ac'); metal.addColorStop(0.18, '#d9dce1'); metal.addColorStop(0.45, '#b7bbc2'); metal.addColorStop(0.7, '#e3e5e9'); metal.addColorStop(1, '#a5a9b0');
  g.fillStyle = metal; g.fillRect(0, 120, 360, 240);
  for (let i = 0; i < 900; i++) { const y = rnd(i) * 360; g.fillStyle = y < 120 ? `rgba(140,170,255,${0.04 + rnd(i + 5) * 0.08})` : `rgba(${rnd(i + 2) > 0.5 ? '255,255,255' : '70,74,82'},${0.05 + rnd(i + 5) * 0.12})`; g.fillRect(rnd(i + 1) * 360 - 40, y, 30 + rnd(i + 3) * 160, 0.7); }
  // the shine where the band of print meets the bare metal
  const edge = g.createLinearGradient(0, 112, 0, 128); edge.addColorStop(0, 'rgba(0,0,40,0.35)'); edge.addColorStop(1, 'rgba(0,0,40,0)');
  g.fillStyle = edge; g.fillRect(0, 120, 360, 8);
}

export class BestBefore extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOXES = [{ x: 11, w: 83, len: 2 }, { x: 99, w: 83, len: 2 }, { x: 187, w: 162, len: 4 }];
  static Y = 177; static H = 56;
  static css = `
    h3 { width: 360px; margin: 0; padding-top: 16px; text-align: center; font: 800 78px/1 ${COND}; font-stretch: condensed; letter-spacing: -0.01em; text-transform: uppercase; color: #d6dbe4; text-shadow: 0 1px 0 #fff, 0 -1px 0 #7d8796; white-space: nowrap; }
    h3 { display: flex; justify-content: center; }
    h3 span { flex: none; transform: scaleX(0.64); }
    label { font: 700 9.5px/1 ${SANS}; letter-spacing: 0.08em; color: #1d36b8; }
    input { width: 83px; height: 56px; padding: 0; border: 0; outline: 0; background: transparent; color: transparent; caret-color: transparent; font: 16px ${SANS}; }
    input::selection { background: transparent; }
    p { width: 330px; margin: 0; font: 12px/1.3 ${SANS}; }`;
  static observedAttributes = ['value'];

  ready() {
    this.born = [[], [], []]; this.caretOn = true;
    const box = this.canvas ?? this.$('.plain'), lot = this.getAttribute('lot') ?? 'L00000', time = this.getAttribute('time') ?? '00:00';
    this.banner = node(`<h3 id="bb"><span>${esc(this.getAttribute('label') ?? 'Best before')}</span></h3>`);
    const names = ['month', 'day', 'year'], holders = ['MM', 'DD', 'YYYY'];
    this.labels = names.map((n) => node(`<label for="bb-${n}">${n.toUpperCase()}</label>`));
    this.fields = names.map((n, i) => node(`<input id="bb-${n}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="${BestBefore.BOXES[i].len}" autocomplete="off" placeholder="${holders[i]}" aria-describedby="bb" aria-label="${n}">`));
    this.lot = node(`<p>Lot ${esc(lot)}, filled at ${esc(time)}</p>`);
    this.lotText = `${lot}  ${time}`.toUpperCase().replace(/[^0-9L:]/g, ' ');
    box.replaceChildren(this.banner, ...this.labels, ...this.fields, this.lot);
    const v = this.getAttribute('value'); if (v) this.value = v;
    this.fields.forEach((f, i) => {
      f.addEventListener('input', () => this.typed(i));
      f.addEventListener('keydown', (e) => this.key(i, e));
      f.addEventListener('focus', () => this.blink(true)); f.addEventListener('blur', () => this.blink(false));
    });
    this.sync();
  }
  attributeChangedCallback(_, __, v) { if (this.fields && v !== null && v !== this.value) this.value = v; }

  // #region best-before
  // Digits only. A field that can take no more digits sends the caret on to the next one.
  typed(i) {
    const f = this.fields[i], v = f.value.replace(/\D/g, '').slice(0, BestBefore.BOXES[i].len);
    if (f.value !== v) f.value = v;
    this.stamp(i);
    const full = v.length === BestBefore.BOXES[i].len || (i === 0 && v.length === 1 && +v > 1) || (i === 1 && v.length === 1 && +v > 3);
    if (full && i < 2) { if (v.length === 1) { f.value = '0' + v; this.stamp(i); } this.fields[i + 1].focus({ preventScroll: true }); this.fields[i + 1].select(); }
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  key(i, e) {
    const f = this.fields[i];
    if (e.key === 'Backspace' && !f.value && i > 0) { e.preventDefault(); const p = this.fields[i - 1]; p.focus({ preventScroll: true }); p.value = p.value.slice(0, -1); this.typed(i - 1); }
    if (e.key === 'ArrowRight' && f.selectionStart === f.value.length && i < 2) { e.preventDefault(); this.fields[i + 1].focus({ preventScroll: true }); }
    if (e.key === 'ArrowLeft' && f.selectionStart === 0 && i > 0) { e.preventDefault(); this.fields[i - 1].focus({ preventScroll: true }); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // each field also works as a spin button
      e.preventDefault();
      const [lo, hi] = [[1, 12], [1, 31], [2000, 2099]][i], by = e.key === 'ArrowUp' ? 1 : -1;
      let n = +f.value || (by > 0 ? lo - 1 : hi + 1); n += by; if (n > hi) n = lo; if (n < lo) n = hi;
      f.value = String(n).padStart(BestBefore.BOXES[i].len, '0'); this.stamp(i); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  // Each character that changed is printed again, so its dots spray in.
  stamp(i) {
    const now = performance.now(), v = this.fields[i].value, was = this.born[i].text ?? '';
    for (let k = 0; k < 4; k++) if (v[k] !== was[k]) this.born[i][k] = v[k] ? now : 0;
    this.born[i].text = v; this.request();
  }
  get value() {
    const [m, d, y] = this.fields.map((f) => f.value);
    if (!m || !d || !y || (y.length !== 2 && y.length !== 4)) return '';
    const year = y.length === 2 ? 2000 + +y : +y, dt = new Date(Date.UTC(year, +m - 1, +d));
    return dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d ? iso(dt) : '';
  }
  set value(v) {
    const dt = v ? day(v) : null;
    const parts = dt ? [String(dt.getUTCMonth() + 1).padStart(2, '0'), String(dt.getUTCDate()).padStart(2, '0'), String(dt.getUTCFullYear())] : ['', '', ''];
    this.fields.forEach((f, i) => { f.value = parts[i]; this.born[i] = []; this.born[i].text = parts[i]; });
    this.sync();
  }
  sync() {
    const v = this.value, some = this.fields.some((f) => f.value), all = this.fields.every((f) => f.value);
    this.setValue(v);
    const bad = all && !v, part = some && !all;
    try { this.internals?.setValidity(bad ? { badInput: true } : part ? { valueMissing: true } : {}, bad ? 'That is not a date' : part ? 'Finish the date' : '', this.fields[bad ? 1 : this.fields.findIndex((f) => !f.value)] ?? this.fields[0]); } catch {}
    this.request();
  }
  blink(on) {
    clearInterval(this.timer); this.caretOn = on;
    if (on && !reduced()) this.timer = setInterval(() => { this.caretOn = !this.caretOn; this.request(); }, 530);
    this.request();
  }

  draw(ctx, w, h, now) {
    const { BOXES, Y, H } = BestBefore;
    ctx.drawImage(cached(this, 'can', 360, 360, drawCan), 0, 0, w, h);
    put(ctx, this.banner, 0, 0);
    let moving = false;
    const focus = this.shadowRoot.activeElement, bad = this.fields.every((f) => f.value) && !this.value;
    BOXES.forEach((b, i) => {
      const f = this.fields[i], on = focus === f;
      put(ctx, this.labels[i], b.x, Y - 12);
      ctx.strokeStyle = bad && i < 2 ? '#c4241a' : '#1d36b8'; ctx.lineWidth = on ? 2.6 : 1.4;
      ctx.strokeRect(b.x, Y, b.w, H);
      hit(ctx, f, b.x, Y, b.w, H);
      // the figures, five dots wide and seven high, sprayed in as they are typed
      const pitch = 6.1, text = f.value;
      moving = inkjet(ctx, text, b.x + 7, Y + (H - pitch * 7) / 2, pitch, now, (k) => this.born[i][k] || 0, i * 101) || moving;
      if (on && this.caretOn && text.length < b.len) { ctx.fillStyle = '#1d36b8'; ctx.fillRect(b.x + 7 + text.length * pitch * 6.2 + 1, Y + 10, 1.6, H - 20); }
    });
    // the lot and the time, printed by the same head when the can was filled
    ctx.save(); ctx.globalAlpha = 0.9;
    inkjet(ctx, this.lotText, 14, 282, 3.9, now, () => 0, 9, '#1a1a1f');
    ctx.restore();
    hit(ctx, this.lot, 12, 280, 330, 31);
    return moving;
  }
  // #endregion best-before
}
customElements.define('best-before', BestBefore);
