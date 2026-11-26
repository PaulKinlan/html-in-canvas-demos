// <fill-progress>: a <progress> and valve button shown on a brushed-aluminium LCD display.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";

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
