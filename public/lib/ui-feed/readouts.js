// ui-feed/readouts.js: five controls that show a reading, rebuilt from demos on ui-feed.dev.
//
//   <moon-calendar name value>     a <table> of day buttons, with the phase of the moon worked out for each day
//   <fill-progress name max>       a <progress> shown on a liquid crystal display, and a button that pours
//   <storage-meter name capacity>  a <meter> for each <option>, one for the total, and a button that clears one
//   <forecast-slider name value>   a range over the hours of a day, with the temperature between the forecasts
//   <walk-circle name value>       a range whose handle is on a circle on a map: minutes of walking to a stop
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /readout-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from './kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
// A range under a drawn handle: the pointer is captured and the control works out the value (see gauges.js).
function grip(el, on) {
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    id = e.pointerId; try { el.setPointerCapture(id); } catch {}      // a pointer made in script cannot be captured
    e.preventDefault(); el.focus({ preventScroll: true }); on.down?.(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) on.move?.(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; on.up?.(e); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return () => id !== null;
}
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

// #region fill-progress
// A <progress> and one button. The button opens a valve: the flow builds up, runs, and is throttled as the
// measure nears full, so the count slows into the last tenth. The display is drawn as liquid crystal, with
// the unlit segments faintly visible.
const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
function sevenSeg(ctx, x, y, w, h, digit, on, off) {
  const t = w * 0.17, g = t * 0.22, m = h / 2;
  const bar = (x0, y0, len, horiz) => { ctx.beginPath(); if (horiz) { ctx.moveTo(x0 + g, y0); ctx.lineTo(x0 + t / 2 + g, y0 - t / 2); ctx.lineTo(x0 + len - t / 2 - g, y0 - t / 2); ctx.lineTo(x0 + len - g, y0); ctx.lineTo(x0 + len - t / 2 - g, y0 + t / 2); ctx.lineTo(x0 + t / 2 + g, y0 + t / 2); } else { ctx.moveTo(x0, y0 + g); ctx.lineTo(x0 + t / 2, y0 + t / 2 + g); ctx.lineTo(x0 + t / 2, y0 + len - t / 2 - g); ctx.lineTo(x0, y0 + len - g); ctx.lineTo(x0 - t / 2, y0 + len - t / 2 - g); ctx.lineTo(x0 - t / 2, y0 + t / 2 + g); } ctx.closePath(); ctx.fill(); };
  const parts = { a: [x, y, w, true], g: [x, y + m, w, true], d: [x, y + h, w, true], f: [x, y, m, false], b: [x + w, y, m, false], e: [x, y + m, m, false], c: [x + w, y + m, m, false] };
  for (const k in parts) { ctx.fillStyle = digit !== null && SEGS[digit].includes(k) ? on : off; bar(...parts[k]); }
}
export class FillProgress extends FeedControl {
  static size = [360, 340];
  static html = `<progress aria-label="Poured"></progress><output class="state" role="status"></output><button type="button" class="go"></button><span class="cup"><slot>cup</slot></span>`;
  static css = `
    progress { width: 284px; height: 20px; opacity: 0; }
    .state { width: 120px; height: 12px; font: 500 9px/12px ${SANS}; opacity: 0; }
    .go { width: 96px; height: 96px; opacity: 0; border-radius: 50%; touch-action: manipulation; }
    .cup { width: 150px; font: 400 11px/1.2 ${SANS}; color: #4b4f52; }`;
  static RATE = 1.7;      // ounces a second with the valve open

  ready() {
    this.bar = this.$('progress'); this.go = this.$('.go');
    this.max = Number(this.getAttribute('max') ?? 8); this.unit = this.getAttribute('unit') ?? 'oz';
    this.bar.max = this.max; this.bar.value = 0;      // a progress with no value is indeterminate, and its animation raises paint events for ever
    this.amount = clamp(Number(this.getAttribute('value') ?? 0), 0, this.max); this.flow = 0; this.mode = this.amount >= this.max ? 'done' : 'idle';
    this.pressed = false;
    const press = (on) => { this.pressed = on; this.request(); };
    this.go.addEventListener('pointerdown', () => press(true));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) this.go.addEventListener(type, () => press(false));
    this.go.addEventListener('click', () => this.toggle());
    this.sync();
  }
  get value() { return this.amount.toFixed(1); }
  // Start, stop, or (when full) empty.
  toggle() {
    this.mode = this.mode === 'filling' ? 'idle' : this.mode === 'done' ? 'emptying' : this.mode === 'emptying' ? 'emptying' : 'filling';
    if (reduced() && this.mode === 'filling') { this.amount = this.max; this.mode = 'done'; }
    if (reduced() && this.mode === 'emptying') { this.amount = 0; this.mode = 'idle'; }
    this.sync(true);
  }
  sync(changed = false) {
    const shown = Number(this.value);
    if (this.bar.value !== shown) this.bar.value = shown;
    this.setValue(this.value);
    const text = { idle: this.amount > 0 ? 'Paused' : '', filling: 'Filling', done: 'Done', emptying: 'Emptying' }[this.mode], st = this.$('.state');
    if (st.textContent !== text) st.textContent = text;
    const label = { idle: 'Fill', filling: 'Stop', done: 'Empty', emptying: 'Emptying' }[this.mode];
    if (this.go.ariaLabel !== label) this.go.ariaLabel = label;
    if (changed) this.dispatchEvent(new Event(this.mode === 'done' ? 'change' : 'input', { bubbles: true }));
    this.request();
  }
  // #region fill-step
  step(dt) {
    const { RATE } = FillProgress, left = this.max - this.amount;
    // the valve: open while filling, throttled over the last half ounce so the measure does not overshoot
    const want = this.mode === 'filling' ? Math.min(RATE, left * 3.2 + 0.12) : this.mode === 'emptying' ? -RATE * 3 : 0;
    this.flow += (want - this.flow) * (1 - Math.exp(-dt * (want ? 7 : 16)));
    if (Math.abs(this.flow) < 0.005 && !want) { this.flow = 0; return false; }
    const before = this.value;
    this.amount = clamp(this.amount + this.flow * dt, 0, this.max);
    if (this.mode === 'filling' && this.amount >= this.max - 0.004) { this.amount = this.max; this.flow = 0; this.mode = 'done'; this.sync(true); return false; }
    if (this.mode === 'emptying' && this.amount <= 0) { this.flow = 0; this.mode = 'idle'; this.sync(true); return false; }
    if (this.value !== before) this.sync(true);
    return true;
  }
  // #endregion fill-step

  draw(ctx, w, h) {
    let live = false;
    for (let i = 0; i < 2; i++) live = this.step(this.dt / 2) || live;
    // brushed aluminium
    const face = ctx.createLinearGradient(0, 0, 0, h); face.addColorStop(0, '#d5d7d9'); face.addColorStop(1, '#bfc2c5');
    ctx.fillStyle = face; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let y = 1; y < h; y += 1.7) { ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd(y) - 0.5) * 0.4); }
    ctx.stroke();
    // the display, set into the panel
    const D = { x: 30, y: 28, w: 300, h: 168 };
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, D.x - 2, D.y - 2, D.w + 4, D.h + 4, 4); ctx.fill();
    const lcd = ctx.createLinearGradient(0, D.y, 0, D.y + D.h); lcd.addColorStop(0, '#a9b59e'); lcd.addColorStop(0.12, '#b8c3ac'); lcd.addColorStop(1, '#aebaa2');
    ctx.fillStyle = lcd; rr(ctx, D.x, D.y, D.w, D.h, 2); ctx.fill();
    const ON = 'rgba(18,22,16,0.92)', OFF = 'rgba(18,22,16,0.055)';
    ctx.font = `600 9.5px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.mode === 'filling' ? ON : OFF; ctx.fillText('Filling', D.x + 14, D.y + 16);
    ctx.fillStyle = this.mode === 'done' ? ON : OFF; ctx.fillText('Done', D.x + 66, D.y + 16);
    // three digits and a point, leaning like the figures on a kitchen scale
    const text = this.value.padStart(4, ' ');                 // " 0.0", "12.5"
    ctx.save(); ctx.transform(1, 0, -0.08, 1, D.y * 0.08 + 8, 0);
    const digits = [text[0], text[1], text[3]], dx = [D.x + 22, D.x + 78, D.x + 146];
    digits.forEach((d, i) => sevenSeg(ctx, dx[i], D.y + 36, 40, 76, d === ' ' ? null : Number(d), ON, OFF));
    ctx.fillStyle = ON; ctx.fillRect(D.x + 127, D.y + 106, 8, 8);
    ctx.restore();
    ctx.fillStyle = ON; ctx.font = `700 15px ${SANS}`; ctx.fillText(this.unit, D.x + 206, D.y + 106);
    ctx.font = `600 9.5px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(`of ${this.max} ${this.unit}`, D.x + D.w - 14, D.y + 108);
    // the bar: 32 cells, the last one lit in part
    const cells = 32, lit = (this.amount / this.max) * cells;
    for (let i = 0; i < cells; i++) { const a = clamp(lit - i); ctx.fillStyle = `rgba(18,22,16,${lerp(0.055, 0.92, a)})`; ctx.fillRect(D.x + 14 + i * 8.5, D.y + 134, 6.5, 14); }
    hit(ctx, this.bar, D.x + 8, D.y + 130, 284, 20); hit(ctx, this.$('.state'), D.x + 10, D.y + 8, 120, 12);
    const gloss = ctx.createLinearGradient(D.x, D.y, D.x + 120, D.y + 140); gloss.addColorStop(0, 'rgba(255,255,255,0.12)'); gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss; ctx.fillRect(D.x, D.y, D.w, D.h);
    // the label and the knob
    const label = { idle: this.amount > 0 ? 'Fill on' : 'Fill', filling: 'Stop', done: 'Empty', emptying: 'Emptying' }[this.mode];
    ctx.fillStyle = '#2f3336'; ctx.font = `600 19px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, 30, 268);
    put(ctx, this.$('.cup'), 30, 276);
    ctx.strokeStyle = 'rgba(47,51,54,0.5)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(40 + ctx.measureText(label).width, 262); ctx.lineTo(226, 262); ctx.stroke();
    const K = { x: 282, y: 264, r: 44 }, down = this.pressed;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(K.x + 1, K.y + (down ? 2 : 5), K.r + 1, 0, TAU); ctx.fill();
    const spun = ctx.createConicGradient(0.6, K.x, K.y);
    for (let i = 0; i <= 12; i++) spun.addColorStop(i / 12, i % 2 ? (down ? '#b2b5b8' : '#c6c9cc') : (down ? '#e3e4e6' : '#f6f7f8'));
    ctx.fillStyle = spun; ctx.beginPath(); ctx.arc(K.x, K.y, K.r - (down ? 1 : 0), 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 0.5; for (let r = 4; r < K.r; r += 2.5) { ctx.beginPath(); ctx.arc(K.x, K.y, r, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(K.x, K.y, K.r - (down ? 1 : 0), 0, TAU); ctx.stroke();
    if (this.go.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(K.x, K.y, K.r + 5, 0, TAU); ctx.stroke(); }
    hit(ctx, this.go, K.x - 48, K.y - 48, 96, 96);
    return live;
  }
}
customElements.define('fill-progress', FillProgress);
// #endregion fill-progress

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

// #region forecast-slider
// A range over the hours the forecast covers. Each <option> is a time with a temperature, and the big
// figure is the temperature between them at the time under the thumb. The sky behind goes dark outside the
// hours between sunrise and sunset.
const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const clock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
export class ForecastSlider extends FeedControl {
  static size = [360, 372];
  static html = `<span class="place"><slot>Here</slot></span><output class="temp"></output><input type="range" aria-label="Forecast time">`;
  static css = `
    .place { width: 200px; font: 700 21px/1 ${SANS}; color: #fff6e4; letter-spacing: -0.01em; }
    .temp { width: 330px; font: 900 112px/1 'Arial Black', 'Helvetica Neue', ${SANS}; color: #fff6e4; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    input { width: 80px; height: 52px; opacity: 0; margin: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static X0 = 38; static X1 = 322; static TY = 222;

  ready() {
    this.range = this.$('input');
    const read = () => {
      let last = -1;
      this.points = options(this).map((o) => { let t = minutes(o.value); if (t <= last) t += 1440; last = t; return { t, temp: Number(o.data.temp), label: o.value }; });
      this.min = this.points[0]?.t ?? 0; this.max = this.points.at(-1)?.t ?? 1440;
      Object.assign(this.range, { min: this.min, max: this.max, step: 10 });
      this.t = clamp(this.t ?? minutes(this.getAttribute('value') ?? '12:00'), this.min, this.max);
      this.shown = this.shown ?? { x: this.temp(this.t), v: 0 };
      this.sync();
    };
    new MutationObserver(read).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-temp', 'value'] });
    let off = 0;
    this.held = grip(this.range, {
      down: (e) => { off = point(this, e).x - this.tx(this.t); this.request(); },
      move: (e) => { const { X0, X1 } = ForecastSlider; this.t = clamp(this.min + ((point(this, e).x - off - X0) / (X1 - X0)) * (this.max - this.min), this.min, this.max); this.sync(true); },
      up: () => { this.t = Math.round(this.t / 10) * 10; this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); },
    });
    this.range.addEventListener('input', () => { if (!this.held()) { this.t = this.range.valueAsNumber; this.sync(true); } });
    read();
  }
  attributeChangedCallback(_, __, v) { if (this.points && v !== null && v !== this.value) this.value = v; }
  tx(t) { return lerp(ForecastSlider.X0, ForecastSlider.X1, (t - this.min) / (this.max - this.min || 1)); }
  // #region forecast-temp
  // Between two forecasts the temperature follows a smooth curve through both, level at each one.
  temp(t) {
    const p = this.points; if (!p.length) return 0;
    if (t <= p[0].t) return p[0].temp;
    for (let i = 1; i < p.length; i++) if (t <= p[i].t) return lerp(p[i - 1].temp, p[i].temp, smooth((t - p[i - 1].t) / (p[i].t - p[i - 1].t)));
    return p.at(-1).temp;
  }
  // #endregion forecast-temp
  get value() { return clock(Math.round(this.t / 10) * 10); }
  set value(v) { let t = minutes(v); if (t < this.min) t += 1440; this.t = clamp(t, this.min, this.max); this.sync(); }
  get temperature() { return Math.round(this.temp(this.t) * 10) / 10; }
  sync(input = false) {
    this.setValue(this.value);
    if (!this.held()) this.range.value = Math.round(this.t / 10) * 10;
    this.range.setAttribute('aria-valuetext', `${this.value}, ${this.temperature.toFixed(1)} degrees`);
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { X0, X1, TY } = ForecastSlider;
    const live = spring(this.shown, this.temp(this.t), this.dt, 260, 30);
    const text = `${this.shown.x.toFixed(1)}°`, out = this.$('.temp');
    if (out.textContent !== text) out.textContent = text;
    // the sky: daylight between sunrise and sunset, with three quarters of an hour of dusk at each end
    const rise = minutes(this.getAttribute('sunrise') ?? '06:00'), set = minutes(this.getAttribute('sunset') ?? '18:00'), tt = this.t % 1440;
    const day = smooth((tt - rise + 22) / 45) * (1 - smooth((tt - set + 22) / 45)) * (this.t >= 1440 ? smooth((tt - rise + 22) / 45) : 1);
    const mix = (a, b) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], day))).join(',')})`;
    ctx.fillStyle = mix([38, 30, 84], [240, 100, 24]); ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(this.tx(this.t), TY, 10, this.tx(this.t), TY, 260); glow.addColorStop(0, `rgba(255,190,110,${0.28 * day + 0.06})`); glow.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.05);
    put(ctx, this.$('.place'), 20, 22);
    ctx.fillStyle = '#fff6e4'; ctx.font = `700 21px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(day > 0.5 ? (this.getAttribute('summary') ?? 'Clear') : 'Night', w - 20, 21);
    put(ctx, out, 16, 62);
    // track, filled up to the thumb
    const x = this.tx(this.t);
    ctx.fillStyle = 'rgba(255,246,228,0.28)'; rr(ctx, X0 - 14, TY - 6, X1 - X0 + 28, 12, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,246,228,0.5)'; rr(ctx, X0 - 14, TY - 6, x - X0 + 14, 12, 6); ctx.fill();
    // ticks and the forecasts
    ctx.strokeStyle = '#fff6e4'; ctx.fillStyle = '#fff6e4'; ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let t = this.min; t <= this.max; t += 60) { const tx = this.tx(t), big = this.points.some((p) => p.t === t); ctx.globalAlpha = big ? 1 : 0.55; ctx.beginPath(); ctx.moveTo(tx, TY + 24); ctx.lineTo(tx, TY + (big ? 33 : 29)); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const p of this.points) {
      const near = 1 - clamp(Math.abs(p.t - this.t) / 120);
      ctx.globalAlpha = 0.7 + near * 0.3; ctx.font = `800 ${(12 + near * 2).toFixed(1)}px ${SANS}`; ctx.fillText(`${p.temp}°`, this.tx(p.t), TY + 50);
      ctx.globalAlpha = 0.8; ctx.font = `600 8px ${SANS}`; ctx.fillText(p.label, this.tx(p.t), TY + 66);
    }
    ctx.globalAlpha = 1;
    // the thumb: a pill with the time on it
    const held = this.held();
    ctx.fillStyle = 'rgba(60,20,0,0.25)'; rr(ctx, x - 29, TY - 14 + (held ? 2 : 4), 58, 30, 15); ctx.fill();
    ctx.fillStyle = '#fff6e4'; rr(ctx, x - 29, TY - 15, 58, 30, 15); ctx.fill();
    ctx.fillStyle = mix([38, 30, 84], [226, 86, 16]); ctx.font = `800 13px ${SANS}`; ctx.fillText(clock(this.t), x, TY + 0.5);
    if (this.range.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; rr(ctx, x - 34, TY - 20, 68, 40, 20); ctx.stroke(); }
    hit(ctx, this.range, x - 40, TY - 26, 80, 52);
    // sunrise and sunset
    ctx.fillStyle = '#fff6e4'; ctx.font = `700 12px ${SANS}`; ctx.textBaseline = 'middle';
    for (const [label, tx, align, up] of [[clock(rise), 20, 'left', true], [clock(set), w - 20, 'right', false]]) {
      ctx.textAlign = align; ctx.fillText(label, tx + (align === 'left' ? 20 : 0), h - 24);
      const ix = align === 'left' ? tx + 7 : tx - ctx.measureText(label).width - 13;
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ix - 7, h - 19); ctx.lineTo(ix + 7, h - 19); ctx.moveTo(ix + 4.5, h - 19); ctx.arc(ix, h - 19, 4.5, 0, Math.PI, true);
      ctx.moveTo(ix, h - 33); ctx.lineTo(ix, h - 27); ctx.moveTo(ix - 2.5, up ? h - 30.5 : h - 29.5); ctx.lineTo(ix, up ? h - 33 : h - 27); ctx.lineTo(ix + 2.5, up ? h - 30.5 : h - 29.5); ctx.stroke();
    }
    return live;
  }
}
customElements.define('forecast-slider', ForecastSlider);
// #endregion forecast-slider

// #region walk-circle
// A range in minutes of walking. Its handle rides on a circle on a street map, and the circle's radius is the
// distance walked in that time at 80 metres a minute. Stops inside the circle are counted. The map is made
// up: a grid of streets from a fixed seed, with stops where tram and metro lines cross them.
const CITY = (() => {
  const lines = (n, seed) => { const out = []; let at = -260; for (let i = 0; at < 260; i++) { at += 14 + rnd(seed + i) * 26; out.push({ at, wide: rnd(seed + i * 3) > 0.8 }); } return out; };
  const xs = lines(0, 10), ys = lines(0, 50), stops = [];
  // a line runs along one street. It has a stop at every second or third crossing
  const route = (along, index, kind, seed) => {
    const fixed = (along === 'x' ? xs : ys)[index].at, cross = along === 'x' ? ys : xs;
    for (let i = Math.floor(rnd(seed) * 3); i < cross.length; i += 2 + Math.floor(rnd(seed + i) * 2)) stops.push(along === 'x' ? { x: fixed, y: cross[i].at, kind } : { x: cross[i].at, y: fixed, kind });
    return { along, at: fixed, kind };
  };
  const mid = (list) => list.reduce((best, l, i) => (Math.abs(l.at) < Math.abs(list[best].at) ? i : best), 0);
  const mx = mid(xs), my = mid(ys);
  const routes = [route('x', mx + 2, 'metro', 1), route('y', my + 1, 'metro', 2), route('x', mx - 3, 'tram', 3), route('y', my - 2, 'tram', 4), route('x', mx + 6, 'tram', 5), route('y', my + 5, 'tram', 6), route('y', my - 6, 'tram', 7)];
  return { xs, ys, stops, routes };
})();

export class WalkCircle extends FeedControl {
  static size = [360, 372];
  static html = `<span class="place"><slot>Here</slot></span><output class="count" aria-live="polite"></output><input type="range" aria-label="Maximum walk to a stop, in minutes">`;
  static css = `
    .place { box-sizing: border-box; padding: 2px 5px; background: #fbf3e4; border: 1px solid #111; color: #111; font: 800 6.5px/1 ${SANS}; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
    .count { width: 200px; height: 12px; font: 500 9px/12px ${SANS}; opacity: 0; }
    input { width: 48px; height: 48px; opacity: 0; margin: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static C = { x: 180, y: 192 }; static SCALE = 0.1; static PACE = 80; static ANGLE = -2.2;     // pixels a metre, metres a minute, where the handle sits

  ready() {
    this.range = this.$('input');
    this.min = Number(this.getAttribute('min') ?? 3); this.max = Number(this.getAttribute('max') ?? 20);
    Object.assign(this.range, { min: this.min, max: this.max, step: 1 });
    this.v = clamp(Math.round(Number(this.getAttribute('value') ?? 12)), this.min, this.max);
    this.r = { x: this.radius(this.v), v: 0 };
    this.pop = CITY.stops.map(() => ({ x: 0, v: 0 }));
    this.maps = [0, 1].map(() => Object.assign(document.createElement('canvas'), { width: 1, height: 1 }));
    this.held = grip(this.range, {
      move: (e) => { const p = point(this, e), { C } = WalkCircle; this.set(Math.hypot(p.x - C.x, p.y - C.y) / WalkCircle.SCALE / WalkCircle.PACE, true); },
      up: () => this.dispatchEvent(new Event('change', { bubbles: true })),
    });
    this.range.addEventListener('input', () => { if (!this.held()) this.set(this.range.valueAsNumber, true); });
    this.set(this.v);
  }
  attributeChangedCallback(_, __, v) { if (this.range && v !== null) this.value = v; }
  radius(min) { return min * WalkCircle.PACE * WalkCircle.SCALE; }
  get value() { return String(this.v); }
  set value(v) { this.set(Number(v)); }
  // The stops within the walk, by kind.
  get reach() {
    const R = this.radius(this.v), out = { metro: 0, tram: 0 };
    for (const s of CITY.stops) if (Math.hypot(s.x, s.y) <= R) out[s.kind]++;
    return out;
  }
  set(v, input = false) {
    v = clamp(Math.round(Number(v) || 0), this.min, this.max);
    const changed = v !== this.v; this.v = v;
    this.setValue(String(v));
    if (!this.held()) this.range.value = v;
    const { metro, tram } = this.reach, text = `${metro + tram} stops within ${v * WalkCircle.PACE} metres`;
    this.range.setAttribute('aria-valuetext', `${v} minutes, ${text}`);
    const out = this.$('.count'); if (out.textContent !== text) out.textContent = text;
    if (changed && input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }
  // The map twice, on two plain canvases: orange with pale streets for outside the circle, pale with dark
  // streets for inside it.
  paintMaps(w, h, px) {
    const { C } = WalkCircle;
    this.maps.forEach((c, inside) => {
      c.width = Math.round(w * px); c.height = Math.round(h * px);
      const g = c.getContext('2d'); g.scale(px, px);
      g.fillStyle = inside ? '#fbf3e4' : '#f25c05'; g.fillRect(0, 0, w, h);
      g.translate(C.x, C.y); g.rotate(-0.14);
      // blocks: some are parks or squares
      CITY.xs.forEach((a, i) => CITY.ys.forEach((b, j) => {
        const k = rnd(i * 31 + j * 17); if (k < 0.82 || !CITY.xs[i + 1] || !CITY.ys[j + 1]) return;
        g.fillStyle = inside ? 'rgba(242,92,5,0.16)' : 'rgba(255,255,255,0.12)'; g.fillRect(a.at + 2, b.at + 2, CITY.xs[i + 1].at - a.at - 4, CITY.ys[j + 1].at - b.at - 4);
      }));
      g.strokeStyle = inside ? '#f25c05' : '#fbe9d2';
      for (const [list, vertical] of [[CITY.xs, true], [CITY.ys, false]]) for (const l of list) {
        g.lineWidth = l.wide ? 2.2 : 0.7; g.beginPath();
        if (vertical) { g.moveTo(l.at, -300); g.lineTo(l.at, 300); } else { g.moveTo(-300, l.at); g.lineTo(300, l.at); }
        g.stroke();
      }
      // the lines: metro thick, tram thin
      for (const r of CITY.routes) {
        g.strokeStyle = inside ? '#111' : '#3a1500'; g.lineWidth = r.kind === 'metro' ? 2.6 : 1.3; g.beginPath();
        if (r.along === 'x') { g.moveTo(r.at, -300); g.lineTo(r.at, 300); } else { g.moveTo(-300, r.at); g.lineTo(300, r.at); }
        g.stroke();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  draw(ctx, w, h) {
    const { C, ANGLE } = WalkCircle;
    const key = `${Math.round(w * this.px)}`;
    if (this.mapsFor !== key) { this.paintMaps(w, h, this.px); this.mapsFor = key; }
    let live = spring(this.r, this.radius(this.v), this.dt, 240, 19);
    const R = this.r.x;
    ctx.drawImage(this.maps[0], 0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.clip(); ctx.drawImage(this.maps[1], 0, 0, w, h); ctx.restore();
    // stops: hollow outside the walk, solid inside, and each one swells as the circle passes it
    ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(-0.14);
    CITY.stops.forEach((s, i) => {
      const inside = Math.hypot(s.x, s.y) <= R;
      if (spring(this.pop[i], inside ? 1 : 0, this.dt, 320, 16)) live = true;
      const k = this.pop[i].x, size = (s.kind === 'metro' ? 3.4 : 2.6) * (1 + k * 0.35);
      ctx.fillStyle = inside ? '#111' : '#fbe9d2'; ctx.strokeStyle = inside ? '#111' : '#3a1500'; ctx.lineWidth = 1;
      ctx.beginPath(); if (s.kind === 'metro') ctx.rect(s.x - size, s.y - size, size * 2, size * 2); else ctx.arc(s.x, s.y, size, 0, TAU);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.stroke();
    put(ctx, this.$('.place'), C.x - this.$('.place').offsetWidth / 2, C.y - 6);
    hit(ctx, this.$('.count'), 10, h - 16, 200, 12);
    // lettering round the circle: the setting either side of the handle, the counts along the bottom
    const along = (text, centre, radius, flip) => {
      ctx.font = `900 10px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const stepA = 7.2 / radius, chars = [...text];
      chars.forEach((ch, n) => {
        const a = centre + (n - (chars.length - 1) / 2) * stepA * (flip ? -1 : 1);
        ctx.save(); ctx.translate(C.x + Math.cos(a) * radius, C.y + Math.sin(a) * radius); ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.strokeStyle = '#f25c05'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(ch, 0, 0); ctx.fillStyle = '#111'; ctx.fillText(ch, 0, 0); ctx.restore();
      });
      return (chars.length * stepA) / 2;
    };
    const gap = 17 / (R + 10), { metro, tram } = this.reach;
    const left = 'MAX WALK', right = `MIN · ${this.v * WalkCircle.PACE} M`;
    along(left, ANGLE - gap - (left.length * 7.2) / (R + 10) / 2, R + 10, false);
    along(right, ANGLE + gap + (right.length * 7.2) / (R + 10) / 2, R + 10, false);
    const m = `${metro} METRO`, t = `${tram} TRAM`;
    along(m, Math.PI / 2 + 0.12 + (m.length * 7.2) / (R + 10) / 2, R + 10, true);
    along(t, Math.PI / 2 - 0.12 - (t.length * 7.2) / (R + 10) / 2, R + 10, true);
    // the handle
    const hx = C.x + Math.cos(ANGLE) * R, hy = C.y + Math.sin(ANGLE) * R, held = this.held();
    ctx.fillStyle = 'rgba(60,20,0,0.3)'; ctx.beginPath(); ctx.arc(hx + 1, hy + (held ? 1 : 3), 14, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx, hy, held ? 15 : 14, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbf3e4'; ctx.font = `900 13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(this.v), hx, hy + 0.5);
    if (this.range.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 19, 0, TAU); ctx.stroke(); }
    hit(ctx, this.range, hx - 24, hy - 24, 48, 48);
    // north
    ctx.save(); ctx.translate(w - 24, 24); ctx.rotate(-0.14); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(0, -17); ctx.lineTo(5, -7); ctx.fill();
    ctx.fillStyle = '#fbf3e4'; ctx.font = `900 8px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, 0.5); ctx.restore();
    return live;
  }
}
customElements.define('walk-circle', WalkCircle);
// #endregion walk-circle
