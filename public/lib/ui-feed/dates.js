// ui-feed/dates.js: five controls for dates and times, rebuilt from demos on ui-feed.dev.
//
//   <night-picker name month prices>    an <input type="date">, and a non-modal <dialog> of radios for the nights
//   <best-before name lot time>         three text fields for month, day and year, printed in inkjet dots
//   <return-slip name now until closed> a receipt. A <details> prints a calendar of radios under it
//   <wall-calendar name month today>    a month of radios, drawn as a print in two colours that can slip
//   <day-plan name label>               radios in a list. The chosen stop is drawn heavier, with a red dot
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /date-controls/.

import { FeedControl, put, hit, esc, clamp, lerp, smooth, easeOut, rr, spring, TAU, reduced } from './kit.js';
import { Fold, cached, focusRing } from './folds.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const SERIF = "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// Dates are kept as UTC midnights, so that no time zone moves a day.
export const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
export const iso = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
const fmt = (dt, o, loc = 'en-US') => dt.toLocaleDateString(loc, { timeZone: 'UTC', ...o });
const sameMonth = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

// ---------------------------------------------------------------------------------------------------------
// A night at the lake: a date input, and a dialog of radios with a price for each night
// ---------------------------------------------------------------------------------------------------------

function drawLake(g) {
  // dusk: violet at the top, pink and orange on the horizon, and the same again upside down in the water
  const H = 252;
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#4b33b8'); sky.addColorStop(0.45, '#6f4fd0'); sky.addColorStop(0.75, '#b06fc6'); sky.addColorStop(0.92, '#f08a86'); sky.addColorStop(1, '#ffb07a');
  g.fillStyle = sky; g.fillRect(0, 0, 360, H);
  const water = g.createLinearGradient(0, H, 0, 318); water.addColorStop(0, '#f6a27f'); water.addColorStop(0.3, '#b672b4'); water.addColorStop(1, '#3a2a7c');
  g.fillStyle = water; g.fillRect(0, H, 360, 70);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,220,200,${0.05 + rnd(i) * 0.12})`; g.fillRect(rnd(i + 1) * 360, H + 4 + rnd(i + 2) * 60, 20 + rnd(i + 3) * 70, 0.8); }
  // the far shore: a low line of trees, and its reflection
  const shore = (y, k, a) => { g.fillStyle = `rgba(28,18,52,${a})`; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 360; x += 4) g.lineTo(x, y - k * (3 + rnd(x * 0.37) * 6 + Math.sin(x * 0.03) * 3)); g.lineTo(360, y); g.closePath(); g.fill(); };
  shore(H + 1, 1, 0.95); shore(H + 1, -0.7, 0.35);
  // pines on the right
  const pine = (x, base, h, w) => { g.beginPath(); g.moveTo(x, base - h); for (let i = 1; i <= 7; i++) { const y = base - h + (h * i) / 7, ww = (w * i) / 7; g.lineTo(x + ww, y); g.lineTo(x + ww * 0.35, y - h / 14); } for (let i = 7; i >= 1; i--) { const y = base - h + (h * i) / 7, ww = (w * i) / 7; g.lineTo(x - ww * 0.35, y - h / 14); g.lineTo(x - ww, y); } g.closePath(); g.fill(); g.fillRect(x - 1, base - 4, 2, 6); };
  g.fillStyle = '#140d26'; pine(330, 292, 112, 15); pine(352, 300, 140, 17); pine(312, 296, 66, 10);
  // the near bank
  g.fillStyle = '#120c20'; g.beginPath(); g.moveTo(0, 318); g.bezierCurveTo(80, 306, 220, 304, 360, 296); g.lineTo(360, 360); g.lineTo(0, 360); g.fill();
  // the tent, lit from inside
  const tx = 122, base = 318;
  g.save(); g.filter = 'blur(14px)'; g.fillStyle = 'rgba(255,170,70,0.55)'; g.beginPath(); g.ellipse(tx, base - 18, 72, 30, 0, 0, TAU); g.fill(); g.restore();
  const canvas = g.createLinearGradient(tx - 60, 0, tx + 60, 0); canvas.addColorStop(0, '#d46a10'); canvas.addColorStop(0.45, '#ffd27a'); canvas.addColorStop(0.6, '#ffc35a'); canvas.addColorStop(1, '#c75e0e');
  g.fillStyle = canvas; g.beginPath(); g.moveTo(tx, base - 78); g.quadraticCurveTo(tx - 22, base - 44, tx - 60, base - 30); g.lineTo(tx - 58, base - 2); g.lineTo(tx + 58, base - 2); g.lineTo(tx + 60, base - 30); g.quadraticCurveTo(tx + 22, base - 44, tx, base - 78); g.fill();
  g.strokeStyle = 'rgba(150,70,10,0.5)'; g.lineWidth = 0.8;
  for (const dx of [-36, -14, 14, 36]) { g.beginPath(); g.moveTo(tx, base - 76); g.lineTo(tx + dx, base - 2); g.stroke(); }
  g.fillStyle = '#ffe6a6'; g.beginPath(); g.moveTo(tx - 5, base - 2); g.lineTo(tx, base - 42); g.lineTo(tx + 9, base - 2); g.fill();
  g.strokeStyle = '#5a3a20'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(tx, base - 78); g.lineTo(tx, base - 90); g.stroke();
}

export class NightPicker extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static DIALOG = { x: 8, y: 56 };
  static css = `
    .field { width: 306px; height: 42px; padding: 5px 12px 0; box-sizing: border-box; background: #fff; color: #1d1648; }
    .field label { display: block; font: 600 9px/1 ${SANS}; color: #5b4fd0; }
    .field input { display: block; width: 180px; margin: 2px 0 0; padding: 0; border: 0; outline: 0; background: transparent; color: #1d1648; font: 700 20px/1.1 ${SANS}; }
    .field input::-webkit-calendar-picker-indicator { display: none; }
    .field output { position: absolute; right: 12px; top: 11px; font: 700 20px/1 ${SANS}; }
    .field output.taken { color: #d23a2c; text-decoration: line-through; }
    button.open { width: 42px; height: 42px; padding: 0; border: 0; background: transparent; cursor: pointer; }
    dialog { width: 344px; margin: 0; padding: 0; border: 0; background: transparent; color: #fff; inset: auto; left: 0; top: 0; }
    dialog h3 { margin: 0 0 4px 8px; font: 700 15px/22px ${SANS}; }
    table { width: 344px; border-collapse: collapse; table-layout: fixed; }
    th { font: 600 8px/14px ${SANS}; opacity: 0.8; }
    td { height: 29px; padding: 0; text-align: center; }
    td label { display: block; position: relative; height: 29px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td b { display: block; padding-top: 3px; font: 700 16px/17px ${SANS}; }
    td small { display: block; font: 500 7.5px/1 ${SANS}; opacity: 0.8; }
    td label:has(:disabled) { opacity: 0.42; cursor: default; }
    td label:has(:disabled) b { text-decoration: line-through; }
    td label:has(:checked) { color: #1d1648; }
    td label:has(:focus-visible) { outline: 2px solid #ffd34d; outline-offset: -2px; border-radius: 8px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { attributes: true, attributeFilter: ['month', 'prices', 'label'] });
    const root = this.shadowRoot;
    root.addEventListener('pointerdown', (e) => { this.pressed = performance.now(); if (e.target === this.canvas && this.want) this.show(false); });
    root.addEventListener('keydown', (e) => {
      if (!this.want) return;
      if (e.key === 'Escape') { e.preventDefault(); this.show(false, true); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.type === 'radio') { e.preventDefault(); this.show(false, true); }
    });
  }
  attributeChangedCallback(_, __, v) { if (this.input && v !== null && v !== this.value) this.value = v; }

  // #region night-picker
  build() {
    const box = this.canvas ?? this.$('.plain'), month = day((this.getAttribute('month') ?? '2027-05') + '-01');
    const prices = (this.getAttribute('prices') ?? '').split(/\s+/).filter(Boolean), was = this.input?.value ?? this.getAttribute('value') ?? '';
    const days = []; for (let d = month; sameMonth(d, month); d = addDays(d, 1)) days.push({ d, value: iso(d), price: prices[d.getUTCDate() - 1] ?? '-' });
    const last = days.at(-1).d, title = fmt(month, { month: 'long', year: 'numeric' });
    this.days = days;
    this.field = node(`<div class="field"><label for="night">${esc(this.getAttribute('label') ?? 'Night of')}</label><input id="night" type="date" min="${iso(month)}" max="${iso(last)}"><output for="night"></output></div>`);
    this.button = node('<button type="button" class="open" aria-haspopup="dialog" aria-expanded="false" aria-label="Choose a night"></button>');
    // Monday first, as the original. A row for each week.
    const lead = (month.getUTCDay() + 6) % 7, cells = [...Array(lead).fill(null), ...days];
    while (cells.length % 7) cells.push(null);
    const rows = []; for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    const cell = (o) => {
      if (!o) return '<td></td>';
      const taken = o.price === '-', said = `${fmt(o.d, { weekday: 'long', day: 'numeric', month: 'long' }, 'en-GB')}, ${taken ? 'taken' : '€' + o.price}`;
      return `<td><label><input type="radio" name="night" value="${o.value}" aria-label="${esc(said)}"${taken ? ' disabled' : ''}><b>${o.d.getUTCDate()}</b><small>${taken ? 'Taken' : '€' + esc(o.price)}</small></label></td>`;
    };
    this.dialog = node(`<dialog aria-label="Choose a night in ${esc(title)}"><h3>${esc(title)}</h3><table><thead><tr>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></dialog>`);
    box.replaceChildren(this.field, this.button, this.dialog);
    this.input = this.field.querySelector('input'); this.price = this.field.querySelector('output');
    this.radios = [...this.dialog.querySelectorAll('input')];
    this.t = 0; this.want = 0; this.disc = { x: 0, v: 0 };
    this.button.addEventListener('click', () => this.show(!this.want));
    this.dialog.addEventListener('change', () => {
      this.input.value = this.radios.find((r) => r.checked)?.value ?? '';
      this.sync(); this.commit();
      if (performance.now() - (this.pressed ?? -1e4) < 800) setTimeout(() => this.show(false, true), reduced() ? 0 : 240);
    });
    // Typing in the date field picks the same night, or says that it is taken.
    this.input.addEventListener('input', () => { for (const r of this.radios) r.checked = r.value === this.input.value && !r.disabled; this.sync(); });
    this.input.addEventListener('change', () => this.commit());
    this.input.value = was; for (const r of this.radios) r.checked = r.value === was && !r.disabled;
    this.sync();
  }
  get value() { return this.input?.value ?? ''; }
  set value(v) { this.input.value = v; for (const r of this.radios) r.checked = r.value === v && !r.disabled; this.sync(); this.request(); }
  commit() { this.dispatchEvent(new Event('change', { bubbles: true })); }
  sync() {
    const o = this.days.find((x) => x.value === this.input.value), taken = o?.price === '-';
    this.price.value = taken ? 'Taken' : o ? '€' + o.price : '';
    this.price.classList.toggle('taken', taken);
    this.setValue(this.input.value);
    try { this.internals?.setValidity(taken ? { customError: true } : this.input.validity.rangeOverflow || this.input.validity.rangeUnderflow ? { rangeOverflow: true } : {}, taken ? 'That night is taken' : 'Choose a night in the month shown', this.input); } catch {}
    this.request();
  }
  // Open or close the dialog. It is opened with the attribute, not showModal(), so it stays in the canvas.
  show(open, refocus = false) {
    if (open && !this.dialog.open) {
      this.dialog.open = true;
      (this.radios.find((r) => r.checked) ?? this.radios.find((r) => !r.disabled))?.focus({ preventScroll: true });
    }
    if (!open && refocus) this.button.focus({ preventScroll: true });
    if (!open && this.plain) this.dialog.close();
    this.want = open ? 1 : 0;
    this.button.setAttribute('aria-expanded', String(open));
    this.request();
  }

  draw(ctx, w, h) {
    const { x: DX, y: DY } = NightPicker.DIALOG, dlg = this.dialog;
    if (this.t !== this.want) this.t = reduced() ? this.want : this.want ? Math.min(1, this.t + this.dt / 0.32) : Math.max(0, this.t - this.dt / 0.18);
    let moving = this.t !== this.want;
    if (this.t === 0 && !this.want && dlg.open) dlg.close();
    ctx.drawImage(cached(this, 'lake', 360, 360, drawLake), 0, 0, w, h);
    if (dlg.open) {
      // a band of dusk behind the calendar, so the figures read over the lake
      const dh = dlg.offsetHeight, shade = ctx.createLinearGradient(0, DY, 0, DY + dh);
      shade.addColorStop(0, 'rgba(52,34,150,0.9)'); shade.addColorStop(1, 'rgba(30,18,84,0.94)');
      ctx.save(); ctx.globalAlpha = easeOut(this.t); ctx.shadowColor = 'rgba(10,4,40,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      ctx.fillStyle = shade; rr(ctx, DX - 2, DY - 4, 348, (dh + 12) * (0.4 + 0.6 * easeOut(this.t)), 10); ctx.fill();
      ctx.restore();
      // the disc under the chosen night grows from nothing
      const on = this.radios.find((r) => r.checked)?.closest('label');
      moving = spring(this.disc, on ? 1 : 0, this.dt, 300, 22) || moving;
      if (on && this.disc.x > 0.01) {
        const s = this.slice(on, dlg);
        ctx.fillStyle = '#ffc533'; ctx.beginPath(); ctx.arc(DX + s.left + s.ew / 2, DY + s.top + s.eh / 2, 15 * clamp(this.disc.x, 0, 1.2), 0, TAU); ctx.fill();
      }
      // the rows come down one after another as it opens, and go together as it closes
      if (this.t === 1) put(ctx, dlg, DX, DY);
      else {
        const rows = [dlg.querySelector('h3'), ...dlg.querySelectorAll('tr')];
        rows.forEach((row, i) => {
          const s = this.slice(row, dlg), p = this.want ? clamp((this.t - i * 0.07) / 0.5) : this.t, e = easeOut(p);
          if (e <= 0.01) return;
          ctx.save(); ctx.globalAlpha = e;
          ctx.beginPath(); ctx.rect(DX, DY + s.top - 10 * (1 - e), s.ew + 1, s.eh + 0.5); ctx.clip();
          put(ctx, dlg, DX, DY - 10 * (1 - e));
          ctx.restore();
        });
        hit(ctx, dlg, DX, DY);
      }
    }
    // the field: "Add a date" until there is one, or while it isn't being typed in
    const focused = this.shadowRoot.activeElement === this.input;
    ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 306, 42);
    if (this.input.value || focused) put(ctx, this.field, 8, 8);
    else {
      hit(ctx, this.field, 8, 8);
      ctx.fillStyle = '#5b4fd0'; ctx.font = `600 9px ${SANS}`; ctx.fillText(this.field.querySelector('label').textContent, 20, 22);
      ctx.fillStyle = '#9a93c9'; ctx.font = `600 20px ${SANS}`; ctx.fillText('Add a date', 20, 43);
    }
    // the button, with a small calendar on it
    const lit = this.want || this.t > 0;
    ctx.fillStyle = lit ? '#f7a823' : '#231a5c'; ctx.fillRect(314, 8, 42, 42);
    put(ctx, this.button, 314, 8, 42, 42);
    ctx.strokeStyle = lit ? '#231a5c' : '#fff'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.4;
    rr(ctx, 326, 21, 18, 16, 2.5); ctx.stroke(); ctx.fillRect(326, 25, 18, 1.4); ctx.fillRect(330, 18.5, 1.4, 4); ctx.fillRect(338.6, 18.5, 1.4, 4);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) ctx.fillRect(328.6 + c * 3.6, 28.6 + r * 3.6, 1.8, 1.8);
    if (this.shadowRoot.activeElement === this.button && this.button.matches(':focus-visible')) focusRing(ctx, 316, 10, 38, 38);
    return moving;
  }
  // #endregion night-picker
}
customElements.define('night-picker', NightPicker);

// ---------------------------------------------------------------------------------------------------------
// Best before: three fields printed in inkjet dots
// ---------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------
// Library renewal: a receipt that prints a calendar when its last line is opened
// ---------------------------------------------------------------------------------------------------------

function drawDesk(g) {
  const wood = g.createLinearGradient(0, 0, 360, 360); wood.addColorStop(0, '#3a2414'); wood.addColorStop(0.5, '#2a190e'); wood.addColorStop(1, '#1d1009');
  g.fillStyle = wood; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '110,70,40' : '15,8,4'},${0.18 + rnd(i + 3) * 0.3})`; g.lineWidth = 0.5 + rnd(i + 1) * 1.6; g.beginPath(); const y = rnd(i + 2) * 380 - 10; g.moveTo(0, y); g.bezierCurveTo(120, y + (rnd(i + 4) - 0.5) * 30, 240, y + (rnd(i + 5) - 0.5) * 30, 360, y + (rnd(i + 6) - 0.5) * 20); g.stroke(); }
  // the spines of three books on the left
  [['#7c2a22', 0], ['#2f4a3c', 15], ['#3b3f5c', 29]].forEach(([c, x], i) => {
    const sp = g.createLinearGradient(x, 0, x + 15, 0); sp.addColorStop(0, 'rgba(0,0,0,0.5)'); sp.addColorStop(0.4, c); sp.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = sp; g.fillRect(x, 54 + i * 4, 15, 260);
    g.fillStyle = 'rgba(214,180,110,0.55)'; g.fillRect(x + 2, 90 + i * 4, 11, 1.2); g.fillRect(x + 2, 250 + i * 4, 11, 1.2);
  });
}
// A wren on a twig, in pen strokes: an oval body, a cocked tail, and hatching for the shading.
function drawWren(g, x, y) {
  g.save(); g.translate(x, y); g.strokeStyle = '#2a2a2a'; g.lineCap = 'round'; g.lineWidth = 0.7;
  const body = new Path2D(); body.ellipse(0, 0, 17, 12, -0.2, 0, TAU);
  g.save(); g.clip(body);
  for (let i = -30; i < 30; i += 2.2) { g.beginPath(); g.moveTo(i, -14); g.lineTo(i + 10, 14); g.stroke(); }
  g.lineWidth = 0.5; for (let i = -30; i < 30; i += 3) { g.beginPath(); g.moveTo(i, 14); g.lineTo(i + 12, -2); g.stroke(); }
  g.restore();
  g.lineWidth = 1; g.stroke(body);
  g.fillStyle = '#f8f8f5'; g.beginPath(); g.ellipse(-3, 5, 9, 5, -0.2, 0, TAU); g.fill();
  // head, eye and beak
  g.fillStyle = '#fafaf7'; g.beginPath(); g.arc(-15, -9, 7, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 0.6; for (let i = -22; i < -8; i += 2) { g.beginPath(); g.moveTo(i, -15); g.lineTo(i + 3, -12); g.stroke(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(-17, -9.5, 1.3, 0, TAU); g.fill();
  g.lineWidth = 1; g.beginPath(); g.moveTo(-21.5, -8.5); g.lineTo(-29, -7); g.lineTo(-21.5, -6.5); g.stroke();
  // the tail, cocked up
  g.beginPath(); g.moveTo(12, -6); g.lineTo(22, -24); g.lineTo(27, -21); g.lineTo(16, -2); g.stroke();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(14 + i * 1.5, -4 - i * 3); g.lineTo(20 + i * 1.5, -6 - i * 3); g.stroke(); }
  // legs and the twig
  g.beginPath(); g.moveTo(-2, 11); g.lineTo(-4, 18); g.moveTo(4, 11); g.lineTo(5, 18); g.stroke();
  g.lineWidth = 1.4; g.beginPath(); g.moveTo(-26, 19); g.bezierCurveTo(-8, 17, 10, 20, 30, 16); g.stroke();
  g.lineWidth = 0.8; g.beginPath(); g.moveTo(16, 18); g.lineTo(24, 24); g.moveTo(-14, 18); g.lineTo(-20, 13); g.stroke();
  g.restore();
}
// A torn edge: a zigzag along y, pointing up (dir -1) or down (dir 1).
function zigzag(ctx, x, y, w, dir) { const n = Math.round(Math.abs(w) / 3), s = Math.sign(w) * 3; for (let i = 0; i <= n; i++) ctx.lineTo(x + i * s, y + (i % 2 ? dir * 2.2 : 0)); }

export class ReturnSlip extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static PAPER = { x: 50, y: 18, w: 260, bottom: 346 };
  static css = `
    .slip { width: 260px; padding: 74px 14px 14px; box-sizing: border-box; color: #1b1b1b; font: 500 9.5px/1.45 ${MONO}; }
    h3 { margin: 0 0 3px; text-align: center; font: 700 12.5px/1.2 ${MONO}; letter-spacing: 0.16em; text-transform: uppercase; }
    .meta { display: flex; justify-content: space-between; padding-bottom: 4px; margin-bottom: 6px; border-bottom: 1px dashed #777; text-transform: uppercase; }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 1fr auto; margin-bottom: 5px; }
    li b { font-weight: 700; text-transform: uppercase; }
    li span:nth-child(even) { text-align: right; text-transform: uppercase; }
    summary { display: flex; align-items: center; gap: 4px; margin-top: 6px; list-style: none; cursor: pointer; font-weight: 700; }
    summary::-webkit-details-marker { display: none; }
    summary i { flex: 1; height: 7px; border-bottom: 1.5px dotted #333; }
    summary b { padding: 2px 6px; border: 1px solid #222; font-weight: 700; }
    summary b::after { content: ' \\25BC'; font-size: 7px; }
    details[open] > summary b::after { content: ' \\25B2'; }
    summary:focus-visible b { outline: 2px solid #1b1b1b; outline-offset: 1px; }
    h4 { display: flex; justify-content: space-between; margin: 12px 0 3px; font: 700 10.5px/1 ${MONO}; letter-spacing: 0.14em; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { font: 500 7.5px/14px ${MONO}; }
    td { height: 17px; padding: 0; text-align: center; }
    td label { display: block; position: relative; line-height: 17px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td label:has(:disabled) { color: #9a9a9a; cursor: default; }
    td label.closed span { text-decoration: line-through; }
    td label.today span::before { content: '['; } td label.today span::after { content: ']'; }
    td label:has(:checked) { background: #1b1b1b; color: #fff; }
    td label:has(:focus-visible) { outline: 1.5px solid #1b1b1b; outline-offset: 1px; }
    .notes { display: grid; grid-template-columns: 1fr auto; margin-top: 8px; font-size: 8px; text-transform: uppercase; }
    .notes span:nth-child(even) { text-align: right; }`;

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['now', 'until', 'closed', 'library', 'kiosk', 'data-due'] });
    const root = this.shadowRoot;
    root.addEventListener('pointerdown', () => { this.pressed = performance.now(); });
    root.addEventListener('keydown', (e) => {
      if (!this.fold?.open) return;
      if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && e.target.type === 'radio')) { e.preventDefault(); this.toggle(false); }
    });
  }

  // #region return-slip
  build() {
    const box = this.canvas ?? this.$('.plain'), now = new Date((this.getAttribute('now') ?? '2026-11-21T14:07') + 'Z'), today = day(iso(now));
    const until = day(this.getAttribute('until') ?? iso(addDays(today, 21))), closed = (this.getAttribute('closed') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const isClosed = (d) => closed.includes(iso(d)) || closed.includes(fmt(d, { weekday: 'short' }).toLowerCase());
    const up = (s) => s.toUpperCase(), short = (d) => up(fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }));
    const books = this.books = [...this.querySelectorAll(':scope > option')].map((o) => ({ no: o.value, title: o.textContent.trim(), author: o.dataset.author ?? '', due: day(o.dataset.due ?? iso(until)) }));
    const first = this.due = books.reduce((a, b) => (b.due < a ? b.due : a), until);
    // the calendar: whole weeks from the start of this month to the last day a loan can be renewed to
    const start = addDays(day(iso(today).slice(0, 8) + '01'), -day(iso(today).slice(0, 8) + '01').getUTCDay()), end = addDays(until, 6 - until.getUTCDay());
    const weeks = []; for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    const cell = (d) => {
      const out = d < today || d > until, shut = isClosed(d), off = out || shut;
      const said = `${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}${shut ? ', closed' : out ? ', not available' : ''}`;
      return `<td><label class="${shut && !out ? 'closed' : ''}${iso(d) === iso(today) ? ' today' : ''}"><input type="radio" name="renew" value="${iso(d)}" aria-label="${esc(said)}"${off ? ' disabled' : ''}><span>${d.getUTCDate()}</span></label></td>`;
    };
    const notes = closed.map((c) => /^\d/.test(c) ? `Closed ${fmt(day(c), { weekday: 'short', month: 'short', day: 'numeric' })}` : `Closed ${c}days`);
    this.slip = node(`<div class="slip">
      <h3>${esc(this.getAttribute('library') ?? 'Library')}</h3>
      <div class="meta"><span>${esc(this.getAttribute('kiosk') ?? '')}</span><span>${esc(up(fmt(now, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })))} ${esc(now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }))}</span></div>
      <ul>${books.map((b) => `<li><b>${esc(b.title)}</b><span>No. ${esc(b.no)}</span><span>${esc(b.author)}</span><span class="due">Due ${esc(short(b.due))}</span></li>`).join('')}</ul>
      <details><summary>Return by <i></i><b></b></summary>
        <h4><span>${esc(up(fmt(today, { month: 'long', year: 'numeric' })))}</span><span>RENEW</span></h4>
        <table><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((t) => `<th>${up(t)}</th>`).join('')}</tr></thead>
        <tbody>${weeks.map((w) => `<tr>${w.map(cell).join('')}</tr>`).join('')}</tbody></table>
        <div class="notes">${notes.map((n, i) => `<span>${esc(n)}</span><span>${i === 0 ? 'Renew to ' + esc(short(until)) : esc(this.getAttribute('closed-note') ?? '')}</span>`).join('')}</div>
      </details></div>`);
    box.replaceChildren(this.slip);
    this.details = this.slip.querySelector('details'); this.summary = this.details.firstElementChild;
    this.radios = [...this.slip.querySelectorAll('input')];
    const pick = this.radios.find((r) => r.value === iso(first)); if (pick) pick.checked = true;
    this.fold = new Fold(this, this.details, 0.5);
    this.summary.addEventListener('click', (e) => { if (this.plain) return; e.preventDefault(); this.toggle(!this.fold.open); });
    this.details.addEventListener('change', () => {
      this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
      if (performance.now() - (this.pressed ?? -1e4) < 800) setTimeout(() => this.toggle(false), reduced() ? 0 : 260);
    });
    this.sync();
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  // The loans due before the new date are renewed to it.
  sync() {
    const v = this.value, to = v ? day(v) : this.due, short = (d) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    this.summary.querySelector('b').textContent = fmt(to, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    this.slip.querySelectorAll('.due').forEach((el, i) => { const b = this.books[i]; el.textContent = 'Due ' + short(b.due < to ? to : b.due); });
    this.setValue(v);
    this.request();
  }
  toggle(open) {
    if (this.plain) { this.details.open = open; return; }
    const inside = this.details.contains(this.shadowRoot.activeElement) && this.shadowRoot.activeElement !== this.summary;
    this.fold.set(open);
    if (open) (this.radios.find((r) => r.checked) ?? this.radios.find((r) => !r.disabled))?.focus({ preventScroll: true });
    else if (inside) this.summary.focus({ preventScroll: true });
  }

  draw(ctx, w, h) {
    const P = ReturnSlip.PAPER, d = this.details, wasOpen = d.open;
    const moving = this.fold.step(this.dt), e = this.fold.e;
    // The frame where the details closes still has the open picture, so it is drawn at the height it had.
    const shut = wasOpen && !d.open, full = shut ? this.full : this.slip.offsetHeight; this.full = full;
    const base = full - (d.open && !shut ? this.fold.h : 0) - (shut ? this.fold.h : 0), tall = base + this.fold.h * e;
    // The paper feeds up out of the printer: as the calendar prints, the top of the receipt rises.
    const lift = Math.max(0, P.y + tall + 6 - P.bottom), top = P.y - lift;
    ctx.drawImage(cached(this, 'desk', 360, 360, drawDesk), 0, 0, w, h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
    const paper = ctx.createLinearGradient(P.x, 0, P.x + P.w, 0); paper.addColorStop(0, '#f1f0ec'); paper.addColorStop(0.5, '#fbfbf9'); paper.addColorStop(1, '#eceae4');
    ctx.fillStyle = paper; ctx.beginPath(); ctx.moveTo(P.x, top + 2); zigzag(ctx, P.x, top + 2, P.w, -1); ctx.lineTo(P.x + P.w, top + tall + 4); zigzag(ctx, P.x + P.w, top + tall + 4, -P.w, 1); ctx.closePath(); ctx.fill();
    ctx.restore();
    drawWren(ctx, P.x + P.w / 2 + 4, top + 38);
    ctx.save(); ctx.beginPath(); ctx.rect(P.x, top, P.w, tall); ctx.clip();
    put(ctx, this.slip, P.x, top, P.w, full);
    ctx.restore();
    return moving || shut;
  }
  // #endregion return-slip
}
customElements.define('return-slip', ReturnSlip);

// ---------------------------------------------------------------------------------------------------------
// Wall calendar printed in two colours
// ---------------------------------------------------------------------------------------------------------

const TEAL = '#14706e', CORAL = '#ef6c58', PAPER = '#f1e8d4';
function drawStock(g) {
  // flecks in the paper, laid over both inks
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${rnd(i) > 0.4 ? '255,252,240' : '120,96,60'},${0.06 + rnd(i + 4) * 0.12})`; const s = 0.5 + rnd(i + 2) ** 2 * 1.6; g.fillRect(rnd(i + 1) * 360, rnd(i + 3) * 360, s, s); }
}

export class WallCalendar extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static GRID = { x: 16, y: 96 };
  static SECONDS = 0.44;
  static css = `
    header { width: 328px; height: 84px; color: ${TEAL}; }
    h2 { position: absolute; left: 0; top: 2px; margin: 0; font: 400 66px/1 ${DISPLAY}; letter-spacing: -0.035em; white-space: nowrap; }
    header span { position: absolute; right: 0; bottom: 6px; font: 400 11px/1 ${DISPLAY}; }
    button { width: 22px; height: 22px; padding: 0; border: 1px solid ${TEAL}; background: transparent; color: ${TEAL}; font: 13px/1 ${SANS}; cursor: pointer; }
    button:focus-visible { outline: 2px solid ${CORAL}; outline-offset: 1px; }
    table { width: 328px; border-collapse: collapse; table-layout: fixed; font: 400 23px/1 ${DISPLAY}; }
    th { height: 22px; padding: 0; font: 400 9.5px/22px ${DISPLAY}; border-top: 1px solid; border-bottom: 1px solid; }
    td { height: 38px; padding: 0; text-align: center; border-bottom: 1px solid; }
    td label { display: block; position: relative; height: 37px; line-height: 37px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td.out { opacity: 0.38; }
    .teal { color: ${TEAL}; }
    .teal th, .teal td { border-color: ${TEAL}; }
    .teal .end { color: transparent; }
    .teal label.today { box-shadow: inset 0 0 0 1px ${TEAL}; }
    .teal label:has(:focus-visible) { outline: 2px dashed ${TEAL}; outline-offset: -4px; }
    .coral { color: transparent; }
    .coral th, .coral td { border-color: transparent; }
    .coral .end { color: ${CORAL}; }
    .coral label.on { background: ${CORAL}; }
    .coral .end label.on { color: #8e2e22; }`;
  static observedAttributes = ['value'];

  ready() {
    const v = this.getAttribute('value'), m = this.getAttribute('month') ?? (v ? v.slice(0, 7) : iso(new Date()).slice(0, 7));
    this.month = day(m + '-01'); this.picked = v ?? ''; this.anim = 1; this.way = 1;
    this.build();
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.picked = e.target.value; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.shadowRoot.addEventListener('keydown', (e) => this.key(e));
  }
  attributeChangedCallback(_, __, v) { if (this.plates && v !== null && v !== this.picked) this.value = v; }

  // #region wall-calendar
  // Two copies of the month: the teal plate holds the radios and the coral plate is only ink.
  build() {
    const box = this.canvas ?? this.$('.plain'), m = this.month, today = this.getAttribute('today') ?? '';
    const start = addDays(m, -m.getUTCDay()), weeks = [];
    for (let d = start; weeks.length < 6 && (weeks.length < 4 || sameMonth(d, m)); d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    const plate = (kind) => {
      const ink = kind === 'teal', head = `<tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((t, i) => `<th class="${i % 6 ? '' : 'end'}" abbr="${t}">${t}</th>`).join('')}</tr>`;
      const cell = (d, i) => {
        const inside = sameMonth(d, m), cls = `${i % 6 ? '' : 'end'}${inside ? '' : ' out'}`;
        if (!inside) return `<td class="${cls}">${d.getUTCDate()}</td>`;
        const v = iso(d), lab = `${v === today ? 'today' : ''}${v === this.picked ? ' on' : ''}`;
        return `<td class="${cls}"><label class="${lab}">${ink ? `<input type="radio" name="day" value="${v}" aria-label="${esc(fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}${v === today ? ', today' : ''}">` : ''}${d.getUTCDate()}</label></td>`;
      };
      return node(`<table class="${kind}"${ink ? '' : ' aria-hidden="true" inert'}><thead>${head}</thead><tbody>${weeks.map((w) => `<tr>${w.map(cell).join('')}</tr>`).join('')}</tbody></table>`);
    };
    const name = fmt(m, { month: 'long' }), year = m.getUTCFullYear();
    this.header = node(`<header><h2 id="cal-title">${esc(name)}</h2><span>${year}</span></header>`);
    if (!this.prev) {
      this.prev = node('<button type="button" aria-label="Previous month">&larr;</button>'); this.next = node('<button type="button" aria-label="Next month">&rarr;</button>');
      this.prev.addEventListener('click', () => this.turn(-1)); this.next.addEventListener('click', () => this.turn(1));
    }
    this.plates = [plate('coral'), plate('teal')];
    this.plates[1].setAttribute('aria-labelledby', 'cal-title');
    box.replaceChildren(this.plates[0], this.plates[1], this.header, this.prev, this.next);
    this.radios = [...this.plates[1].querySelectorAll('input')];
    for (const r of this.radios) r.checked = r.value === this.picked;
    this.setValue(this.picked);
  }
  get value() { return this.picked; }
  set value(v) { this.picked = v; if (v && !sameMonth(day(v), this.month)) { this.month = day(v.slice(0, 7) + '-01'); this.build(); } else this.sync(); }
  // The coral plate shows the chosen day as a filled square. It is a copy, so its class follows the radio.
  sync() {
    for (const l of this.plates[0].querySelectorAll('label')) l.classList.toggle('on', false);
    const i = this.radios.findIndex((r) => r.value === this.picked);
    if (i >= 0) this.plates[0].querySelectorAll('label')[i].classList.add('on');
    this.setValue(this.picked); this.request();
  }
  // Turn the page: both plates slide out, the month is rebuilt half way, and they slide in. The coral plate
  // runs a little behind the teal one, as a second colour does on a press that is out of register.
  turn(dir, then) {
    this.way = dir; this.anim = reduced() ? 1 : 0;
    clearTimeout(this.swap);
    const go = () => { this.month = day(iso(addDays(this.month, dir > 0 ? 32 : -1)).slice(0, 7) + '-01'); this.build(); this.sync(); then?.(); };
    if (reduced()) go(); else this.swap = setTimeout(go, (WallCalendar.SECONDS * 1000) / 2);
    this.request();
  }
  // Arrow keys move by a day or a week and cross into the next month. Page Up and Page Down turn the page.
  key(e) {
    if (e.target.type !== 'radio') return;
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); this.turn(e.key === 'PageDown' ? 1 : -1, () => this.radios[0]?.focus({ preventScroll: true })); return; }
    if (!by) return;
    e.preventDefault();
    const to = iso(addDays(day(e.target.value), by)), pick = () => { const r = this.radios.find((x) => x.value === to); if (!r) return; r.checked = true; r.focus({ preventScroll: true }); this.picked = to; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); };
    if (sameMonth(day(to), this.month)) pick(); else this.turn(by > 0 ? 1 : -1, pick);
  }

  // How far a plate is from its place, and how much of it shows, at point p of a page turn.
  shift(p) {
    if (p >= 1) return { dx: 0, a: 1 };
    return p < 0.5 ? { dx: -this.way * 46 * (p * 2) ** 2, a: 1 - p * 2 } : { dx: this.way * 46 * (1 - easeOut((p - 0.5) * 2)), a: (p - 0.5) * 2 };
  }
  draw(ctx, w, h) {
    const { x: GX, y: GY } = WallCalendar.GRID;
    let moving = false;
    if (this.anim < 1) { this.anim = Math.min(1, this.anim + this.dt / WallCalendar.SECONDS); moving = true; }
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    const teal = this.shift(this.anim), coral = this.shift(clamp((this.anim - 0.1) / 0.9));
    // a press out of register: the coral sits a little off the teal at rest as well
    ctx.save(); ctx.globalAlpha = coral.a; ctx.globalCompositeOperation = 'multiply';
    put(ctx, this.plates[0], GX + coral.dx * 1.12 + 0.8, GY + 0.6);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = teal.a; ctx.globalCompositeOperation = 'multiply';
    put(ctx, this.header, GX + teal.dx * 0.7, 6);
    put(ctx, this.plates[1], GX + teal.dx, GY);
    ctx.restore();
    // the radios answer where they will be, not where they are passing
    if (this.anim < 1) hit(ctx, this.plates[1], GX, GY);
    put(ctx, this.prev, 302, 12); put(ctx, this.next, 323, 12);
    ctx.drawImage(cached(this, 'stock', 360, 360, drawStock), 0, 0, w, h);
    return moving;
  }
  // #endregion wall-calendar
}
customElements.define('wall-calendar', WallCalendar);

// ---------------------------------------------------------------------------------------------------------
// A day out: radios in a list. The stop that is chosen or focused is drawn heavier, with a red dot.
// ---------------------------------------------------------------------------------------------------------

export class DayPlan extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static LIST = { x: 14, y: 22 };
  static css = `
    ol { width: 334px; margin: 0; padding: 0; list-style: none; }
    li { height: 85px; }
    label { display: grid; grid-template-columns: 84px 1fr; column-gap: 34px; position: relative; cursor: pointer; }
    time { grid-row: span 2; text-align: right; font: 400 23px/1.15 ${SERIF}; }
    b { font: 400 23px/1.15 ${SERIF}; }
    small { font: 400 12px/1.45 ${SERIF}; }
    input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; }
    .light { color: #a2905c; }
    .heavy { color: #1d180c; }
    .heavy time, .heavy b { font-weight: 800; letter-spacing: -0.01em; }
    .heavy small { font-weight: 600; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    const root = this.shadowRoot;
    root.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); });
    root.addEventListener('focusin', () => this.request()); root.addEventListener('focusout', () => this.request());
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region day-plan
  build() {
    const box = this.canvas ?? this.$('.plain'), stops = [...this.querySelectorAll(':scope > option')].map((o) => ({ value: o.value || o.textContent.trim(), time: o.dataset.time ?? '', title: o.textContent.trim(), note: o.dataset.note ?? '' }));
    const was = this.radios ? this.value : this.getAttribute('value');
    const list = (kind) => node(`<ol class="${kind}"${kind === 'heavy' ? ' aria-hidden="true" inert' : ` aria-label="${esc(this.getAttribute('label') ?? 'Plan')}"`}>${stops.map((s) => `<li><label>${kind === 'light' ? `<input type="radio" name="stop" value="${esc(s.value)}">` : ''}<time>${esc(s.time)}</time><b>${esc(s.title)}</b><small>${esc(s.note)}</small></label></li>`).join('')}</ol>`);
    // A second, heavier copy of the list is drawn over each stop as it is chosen. Only the first takes input.
    this.light = list('light'); this.heavy = list('heavy');
    box.replaceChildren(this.light, this.heavy);
    this.radios = [...this.light.querySelectorAll('input')];
    for (const r of this.radios) r.checked = r.value === was;
    this.weights = this.radios.map((r) => ({ x: r.checked ? 1 : 0, v: 0 }));
    this.setValue(this.value);
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === v; this.setValue(this.value); this.request(); }
  // The stop that shows: the radio with focus, or else the checked one.
  get shown() { const f = this.radios.indexOf(this.shadowRoot.activeElement); return f >= 0 ? f : this.radios.findIndex((r) => r.checked); }

  draw(ctx, w, h) {
    const { x: LX, y: LY } = DayPlan.LIST, rows = [...this.light.children], at = this.shown;
    let moving = false;
    ctx.fillStyle = '#f5e3a3'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(140, 120, 20, 180, 180, 300); g.addColorStop(0, 'rgba(255,248,210,0.5)'); g.addColorStop(1, 'rgba(200,170,90,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // the line through the stops
    const DX = LX + 84 + 17, first = LY + 14, last = LY + (rows.length - 1) * 85 + 14;
    ctx.fillStyle = '#c9b06a'; ctx.fillRect(DX - 0.6, first, 1.2, last - first);
    rows.forEach((li, i) => {
      const s = this.weights[i], target = i === at ? 1 : 0;
      moving = spring(s, target, this.dt, 260, 24) || moving;
      const e = clamp(s.x), y = LY + li.offsetTop;
      // each stop is cut from both copies: the light one fades out as the heavy one fades in
      ctx.save(); ctx.beginPath(); ctx.rect(LX - 4, y - 2, 340, li.offsetHeight); ctx.clip();
      if (e < 0.99) { ctx.globalAlpha = 1 - e; put(ctx, this.light, LX, LY); }
      if (e > 0.01) { ctx.globalAlpha = e; put(ctx, this.heavy, LX, LY); }
      ctx.restore();
      ctx.fillStyle = '#e04a2f'; ctx.beginPath(); ctx.arc(DX, y + 14, 9.5 * clamp(s.x, 0, 1.3), 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d180c'; ctx.beginPath(); ctx.arc(DX, y + 14, 3, 0, TAU); ctx.fill();
    });
    hit(ctx, this.light, LX, LY);
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) { const li = f.closest('li'); focusRing(ctx, LX - 4, LY + li.offsetTop - 4, 342, 70, '#1d180c'); }
    return moving;
  }
  // #endregion day-plan
}
customElements.define('day-plan', DayPlan);
