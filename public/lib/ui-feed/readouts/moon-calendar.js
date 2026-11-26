// <moon-calendar>: a <table> of day buttons with the phase of the moon drawn in each cell.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, spring, TAU, reduced } from '../kit.js';

const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
let grainTile = null;
function grain(ctx, w, h, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    let s = 11;
    for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = (s >> 8) & 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 127 ? 255 : 0; d.data[i + 3] = Math.abs(v - 127); }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
}

// #region moon-phase
// The age of the moon as a fraction of its cycle: 0 is new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
// Counted from the new moon of 6 January 2000, 18:14 UTC, with the mean length of a cycle. It is within about
// half a day of the true phase, which is enough to put a quarter on the right day or the one beside it.
const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
export const moonPhase = (days) => { const p = ((days - NEW_MOON) / SYNODIC) % 1; return p < 0 ? p + 1 : p; };
const dayNumber = (y, m, d) => Date.UTC(y, m, d) / 86400000;
// The quarter that falls during a day, if one does.
export function quarterOn(day) {
  const a = moonPhase(day), b = moonPhase(day + 1);
  for (const [at, name] of [[0.25, 'First'], [0.5, 'Full'], [0.75, 'Last']]) if (a < at && b >= at) return name;
  return b < a ? 'New' : '';
}
function drawMoon(ctx, cx, cy, r, p, lit, dark) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  if (p > 0.5) { ctx.scale(-1, 1); p = 1 - p; }            // waning: the mirror image of waxing
  const k = Math.cos(p * TAU);                              // 1 at new, 0 at the quarter, -1 at full
  ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
  ctx.fillStyle = lit; ctx.fill();
  ctx.restore();
}
// #endregion moon-phase

// #region moon-calendar
// A month as a table of buttons. The table is drawn once as an element, which gives the day numbers, the
// names of the quarters and every button's hit region. The canvas draws a moon in each cell.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export class MoonCalendar extends FeedControl {
  static size = [360, 384];
  static html = `<output class="month" aria-live="polite"></output><button type="button" class="prev" aria-label="Previous month"></button><button type="button" class="next" aria-label="Next month"></button>
    <table role="grid"><thead><tr>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => `<th scope="col" abbr="${d}">${d.slice(0, 3)}</th>`).join('')}</tr></thead><tbody></tbody></table>`;
  static css = `
    .month { width: 250px; font: 400 40px/1 ${SERIF}; color: #eef3ee; letter-spacing: -0.02em; white-space: nowrap; }
    .prev, .next { width: 40px; height: 40px; opacity: 0; touch-action: manipulation; }
    table { width: 336px; table-layout: fixed; border-collapse: collapse; }
    th { height: 18px; padding: 0 0 0 3px; font: 500 6.5px/18px ${SANS}; letter-spacing: 0.22em; text-transform: uppercase; text-align: left; color: #cfe0d4; }
    td { height: 45px; padding: 0; border-top: 0.6px solid rgba(238,243,238,0.35); }
    td button { all: unset; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; width: 48px; height: 45px; padding: 3px 3px 3px; cursor: pointer;
      font: 400 14.5px/1 ${SERIF}; color: #eef3ee; touch-action: manipulation; }
    td button small { font: 500 5.5px/1 ${SANS}; letter-spacing: 0.2em; text-transform: uppercase; min-height: 6px; }
    td button.out { color: #4fa07a; }`;
  static observedAttributes = ['value'];
  static GRID = { x: 12, y: 78, cw: 48, ch: 45.6, head: 18 };

  ready() {
    const v = (this.getAttribute('value') ?? '').match(/^(\d{4})-(\d\d)-(\d\d)$/), now = new Date();
    this.sel = v ? [Number(v[1]), Number(v[2]) - 1, Number(v[3])] : [now.getFullYear(), now.getMonth(), now.getDate()];
    this.year = this.sel[0]; this.mon = this.sel[1];
    this.roll = { x: 0, v: 0 };
    this.$('.prev').addEventListener('click', () => this.go(-1));
    this.$('.next').addEventListener('click', () => this.go(1));
    const body = this.$('tbody');
    body.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.pick(b.dataset.date); });
    body.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key], b = e.target.closest('button');
      if (!step || !b) return;
      e.preventDefault();
      const next = this.buttons[this.buttons.indexOf(b) + step];
      if (next) { for (const x of this.buttons) x.tabIndex = x === next ? 0 : -1; next.focus({ preventScroll: true }); this.request(); }
    });
    this.build();
  }
  attributeChangedCallback(_, __, v) { if (this.buttons && v !== null && v !== this.value) this.pick(v); }
  get value() { const [y, m, d] = this.sel; return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  set value(v) { this.pick(v); }
  // The day number (days since 1970) of the first cell: the Sunday on or before the first of the month.
  get first() { return dayNumber(this.year, this.mon, 1) - new Date(Date.UTC(this.year, this.mon, 1)).getUTCDay(); }
  go(by) {
    const before = this.first;
    const d = new Date(Date.UTC(this.year, this.mon + by, 1)); this.year = d.getUTCFullYear(); this.mon = d.getUTCMonth();
    if (!reduced()) this.roll.x += before - this.first;        // the moons carry on from where they were and run to the new month
    this.build();
  }
  pick(iso) {
    const m = String(iso).match(/^(\d{4})-(\d\d)-(\d\d)$/); if (!m) return;
    this.sel = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    if (this.sel[0] !== this.year || this.sel[1] !== this.mon) { const before = this.first; this.year = this.sel[0]; this.mon = this.sel[1]; if (!reduced()) this.roll.x += before - this.first; }
    this.build();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  build() {
    const first = this.first, focused = this.shadowRoot.activeElement?.dataset?.date;
    this.cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date((first + i) * 86400000), iso = d.toISOString().slice(0, 10);
      return { day: first + i, n: d.getUTCDate(), iso, out: d.getUTCMonth() !== this.mon, quarter: quarterOn(first + i), on: iso === this.value };
    });
    this.$('tbody').innerHTML = [0, 1, 2, 3, 4, 5].map((r) => `<tr>${this.cells.slice(r * 7, r * 7 + 7).map((c) =>
      `<td><button type="button" data-date="${c.iso}" class="${c.out ? 'out' : ''}" aria-pressed="${c.on}" tabindex="${c.on ? 0 : -1}" aria-label="${c.n} ${MONTHS[new Date(c.day * 86400000).getUTCMonth()]}${c.quarter ? `, ${c.quarter.toLowerCase()} ${c.quarter === 'New' || c.quarter === 'Full' ? 'moon' : 'quarter'}` : ''}">${c.n}<small>${c.quarter}</small></button></td>`).join('')}</tr>`).join('');
    this.buttons = this.$$('tbody button');
    if (!this.buttons.some((b) => b.tabIndex === 0)) this.buttons.find((b) => !b.classList.contains('out')).tabIndex = 0;
    if (focused) this.buttons.find((b) => b.dataset.date === focused)?.focus({ preventScroll: true });
    this.$('.month').textContent = MONTHS[this.mon];
    this.$('table').ariaLabel = `${MONTHS[this.mon]} ${this.year}`;
    this.setValue(this.value);
    this.request();
  }

  draw(ctx, w, h) {
    const G = MoonCalendar.GRID;
    const live = spring(this.roll, 0, this.dt, 26, 10);
    const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#0f6a45'); bg.addColorStop(1, '#0a5236');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.07);
    put(ctx, this.$('.month'), 14, 14);
    ctx.fillStyle = '#cfe0d4'; ctx.font = `500 8px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText([...String(this.year)].join(' '), w - 14, 54);
    ctx.strokeStyle = '#eef3ee'; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [el, x, dir] of [[this.$('.prev'), w - 52, -1], [this.$('.next'), w - 22, 1]]) {
      ctx.beginPath(); ctx.moveTo(x - 6 * dir, 28); ctx.lineTo(x + 6 * dir, 28); ctx.moveTo(x + 2 * dir, 24); ctx.lineTo(x + 6 * dir, 28); ctx.lineTo(x + 2 * dir, 32); ctx.stroke();
      if (el.matches(':focus-visible')) { ctx.strokeRect(x - 12, 16, 24, 24); }
      hit(ctx, el, x - 20, 8, 40, 40);
    }
    // the chosen day, under the table
    this.cells.forEach((c, i) => {
      if (!c.on) return;
      const x = G.x + (i % 7) * G.cw, y = G.y + G.head + Math.floor(i / 7) * G.ch;
      ctx.fillStyle = 'rgba(238,243,238,0.16)'; ctx.fillRect(x - 1, y + 1, G.cw, G.ch - 1.5);
      ctx.strokeStyle = '#eef3ee'; ctx.lineWidth = 0.8; ctx.strokeRect(x - 1, y + 1, G.cw, G.ch - 1.5);
    });
    put(ctx, this.$('table'), G.x, G.y);
    // a moon in each cell: silver where it is lit, with the fine lines of an engraving
    this.cells.forEach((c, i) => {
      const cx = G.x + (i % 7) * G.cw + 33, cy = G.y + G.head + Math.floor(i / 7) * G.ch + 22, p = moonPhase(c.day + 0.5 + this.roll.x);
      const tone = c.out ? ['#3d9a70', '#0b5a3b'] : ['#dfe5e1', '#0b5a3b'];
      drawMoon(ctx, cx, cy, 10.5, p, tone[0], tone[1]);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 10.5, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(11,90,59,0.28)'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let k = -14; k <= 14; k += 2.2) { ctx.moveTo(cx + k - 4, cy - 11); ctx.lineTo(cx + k + 4, cy + 11); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = c.out ? '#3d9a70' : '#eef3ee'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(cx, cy, 10.5, 0, TAU); ctx.stroke();
      const b = this.buttons[i];
      if (b?.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeRect(G.x + (i % 7) * G.cw + 1, G.y + G.head + Math.floor(i / 7) * G.ch + 3, G.cw - 4, G.ch - 5); ctx.setLineDash([]); }
    });
    return live;
  }
}
customElements.define('moon-calendar', MoonCalendar);
// #endregion moon-calendar
