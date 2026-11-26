// <darkroom-timer>: an <input type="number"> shown as a tape on a drum behind a red darkroom window.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, hit, clamp, rr, spring, TAU, reduced } from '../kit.js';

let grainTile = null;
function grain(ctx, w, h, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    let s = 11;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 8) & 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 127 ? 255 : 0; d.data[i + 3] = Math.abs(v - 127);
    }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
}
const NARROW = "'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif";

// #region darkroom-timer
// The seconds of an enlarger timer, under a safelight. The value is an <input type="number"> that lies over
// the window, so it can be typed in. The numbers are printed on a tape round a drum: each one is placed by
// the sine of its angle on the drum and narrowed by the cosine, which is what a cylinder looks like from the
// front. The knob is an <input type="range"> turned by the direction of the pointer from its centre.
export class DarkroomTimer extends FeedControl {
  static size = [360, 372];
  static html = `<input type="number" class="value" inputmode="numeric" aria-label="Seconds"><button type="button" class="dec" aria-label="One second less"></button><input type="range" class="knob" aria-label="Seconds, turn"><button type="button" class="inc" aria-label="One second more"></button>`;
  static css = `
    .value { width: 312px; height: 150px; opacity: 0; font-size: 40px; text-align: center; touch-action: manipulation; }
    .dec, .inc { width: 66px; height: 66px; opacity: 0; touch-action: manipulation; }
    .knob { width: 92px; height: 92px; opacity: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static K = { x: 180, y: 292 };
  static STEP = 108; static DRUM = 196;     // tape between two numbers, and the radius of the drum, in units

  ready() {
    this.field = this.$('.value'); this.knob = this.$('.knob');
    this.min = Number(this.getAttribute('min') ?? 1); this.max = Number(this.getAttribute('max') ?? 60);
    Object.assign(this.field, { min: this.min, max: this.max, step: 1 });
    Object.assign(this.knob, { min: this.min, max: this.max, step: 1 });
    this.v = clamp(Math.round(Number(this.getAttribute('value') ?? 8)), this.min, this.max);
    this.tape = { x: this.v, v: 0 };
    this.field.addEventListener('input', () => { if (Number.isFinite(this.field.valueAsNumber)) this.set(this.field.valueAsNumber, false, true); });
    this.field.addEventListener('change', () => this.set(this.v, true));
    this.$('.dec').addEventListener('click', () => this.set(this.v - 1, true));
    this.$('.inc').addEventListener('click', () => this.set(this.v + 1, true));
    const k = this.knob;
    const dir = (e) => { const r = this.canvas.getBoundingClientRect(), s = r.width / DarkroomTimer.size[0]; return Math.atan2(e.clientY - r.top - DarkroomTimer.K.y * s, e.clientX - r.left - DarkroomTimer.K.x * s); };
    k.addEventListener('pointerdown', (e) => { if (e.button) return; k.setPointerCapture(e.pointerId); this.grip = { a: dir(e), at: this.tape.x }; e.preventDefault(); k.focus({ preventScroll: true }); });
    k.addEventListener('pointermove', (e) => {
      if (!this.grip) return;
      let d = dir(e) - this.grip.a; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.grip.a += d;
      // a tenth of a turn for each second, and the tape follows the hand between the numbers
      this.grip.at = clamp(this.grip.at + d / (TAU / 10), this.min, this.max);
      this.tape.x = this.grip.at; this.tape.v = 0;
      this.set(Math.round(this.grip.at), false);
    });
    const drop = () => { if (!this.grip) return; this.grip = null; this.set(this.v, true); };
    k.addEventListener('pointerup', drop); k.addEventListener('pointercancel', drop);
    k.addEventListener('input', () => { if (!this.grip) this.set(k.valueAsNumber, false); });
    k.addEventListener('change', () => { if (!this.grip) this.set(this.v, true); });
    this.set(this.v, false);
  }
  attributeChangedCallback(_, __, v) { if (this.field && v !== null) this.value = v; }
  get value() { return String(this.v); }
  set value(v) { this.set(Number(v), false); }
  set(v, done, typing = false) {
    v = clamp(Math.round(Number(v) || 0), this.min, this.max);
    const changed = v !== this.v;
    this.v = v;
    this.setValue(String(v));
    if (!typing) this.field.value = v;
    if (!this.grip) this.knob.value = v;
    if (changed) this.dispatchEvent(new Event('input', { bubbles: true }));
    if (done) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { K, STEP, DRUM } = DarkroomTimer, RED = '#ff2f4a';
    let live = false;
    if (!this.grip) { if (reduced()) this.tape.x = this.v; else live = spring(this.tape, this.v, this.dt, 170, 22); }
    const pos = this.tape.x;
    ctx.fillStyle = '#050203'; ctx.fillRect(0, 0, w, h);
    // the case, edged by the safelight
    const rim = ctx.createLinearGradient(0, 0, w, h * 0.6); rim.addColorStop(0, 'rgba(255,47,74,0.75)'); rim.addColorStop(0.5, 'rgba(255,47,74,0.12)'); rim.addColorStop(1, 'rgba(255,47,74,0.03)');
    ctx.strokeStyle = rim; ctx.lineWidth = 1.4;
    rr(ctx, 8, 8, w - 16, h - 16, 24); ctx.stroke(); rr(ctx, 16, 16, w - 32, 190, 18); ctx.stroke();
    // the window: a band of the drum, bowed at the top and bottom
    const X = 24, Y = 26, W = 312, H = 164, cx = X + W / 2;
    const band = () => { ctx.beginPath(); ctx.moveTo(X, Y + 10); ctx.quadraticCurveTo(cx, Y - 6, X + W, Y + 10); ctx.lineTo(X + W, Y + H - 10); ctx.quadraticCurveTo(cx, Y + H + 8, X, Y + H - 10); ctx.closePath(); };
    ctx.save(); band(); ctx.clip();
    const glow = ctx.createRadialGradient(cx, Y + H * 0.45, 10, cx, Y + H * 0.45, W * 0.62);
    glow.addColorStop(0, '#ff2f4a'); glow.addColorStop(0.55, '#c8142c'); glow.addColorStop(1, '#4d0611');
    ctx.fillStyle = glow; ctx.fillRect(X, Y - 8, W, H + 18);
    grain(ctx, w, h, 0.09);
    // the numbers on the drum
    ctx.fillStyle = '#12050a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `700 150px ${NARROW}`;
    const first = Math.max(this.min, Math.floor(pos) - 2), last = Math.min(this.max, Math.ceil(pos) + 2);
    for (let n = first; n <= last; n++) {
      const phi = ((n - pos) * STEP) / DRUM;
      if (Math.abs(phi) > 1.35) continue;
      ctx.save(); ctx.translate(cx + Math.sin(phi) * DRUM, Y + 134 - (1 - Math.cos(phi)) * 6); ctx.scale(Math.cos(phi) * 0.66, 1);
      ctx.globalAlpha = clamp(Math.cos(phi) * 1.3); ctx.fillText(String(n), 0, 0); ctx.restore();
    }
    // sprocket holes along the top and a scale of tenths along the bottom, both on the tape
    for (let i = Math.floor((pos - 2) * 8); i <= (pos + 2) * 8; i++) {
      const phi = ((i / 8 - pos) * STEP) / DRUM; if (Math.abs(phi) > 1.4) continue;
      const x = cx + Math.sin(phi) * DRUM, c = Math.cos(phi), bow = (1 - c) * 9;
      ctx.fillStyle = '#12050a'; ctx.fillRect(x - 3.2 * c, Y + 5 + bow, 6.4 * c, 2.6);
    }
    ctx.strokeStyle = '#12050a';
    for (let i = Math.floor((pos - 2) * 10); i <= (pos + 2) * 10; i++) {
      if (i < this.min * 10 || i > this.max * 10) continue;
      const phi = ((i / 10 - pos) * STEP) / DRUM; if (Math.abs(phi) > 1.4) continue;
      const x = cx + Math.sin(phi) * DRUM, bow = (1 - Math.cos(phi)) * 9, len = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6;
      ctx.lineWidth = i % 10 === 0 ? 1.4 : 0.8; ctx.beginPath(); ctx.moveTo(x, Y + H - 12 - bow); ctx.lineTo(x, Y + H - 12 - bow - len); ctx.stroke();
    }
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(X, Y + H - 12 - 9); ctx.quadraticCurveTo(cx, Y + H - 4, X + W, Y + H - 12 - 9); ctx.stroke();
    // the drum is round, so its sides fall away into the dark
    const sides = ctx.createLinearGradient(X, 0, X + W, 0);
    sides.addColorStop(0, 'rgba(5,2,3,0.8)'); sides.addColorStop(0.2, 'rgba(5,2,3,0)'); sides.addColorStop(0.8, 'rgba(5,2,3,0)'); sides.addColorStop(1, 'rgba(5,2,3,0.8)');
    ctx.fillStyle = sides; ctx.fillRect(X, Y - 8, W, H + 18);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,47,74,0.6)'; ctx.lineWidth = 1; band(); ctx.stroke();
    // the hairline the number is read against
    ctx.strokeStyle = this.field.matches(':focus-visible') ? '#fff' : '#12050a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, Y + H - 34); ctx.lineTo(cx, Y + H + 4); ctx.stroke();
    ctx.fillStyle = RED; ctx.beginPath(); ctx.moveTo(cx, Y + H + 12); ctx.lineTo(cx - 4, Y + H + 18); ctx.lineTo(cx + 4, Y + H + 18); ctx.closePath(); ctx.fill();
    if (this.field.matches(':focus-visible')) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; rr(ctx, X + 4, Y + 4, W - 8, H - 8, 10); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.field, X, Y + 6, W, 150);
    ctx.fillStyle = RED; ctx.font = `700 9px ${NARROW}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('S E C', 30, 224);

    // minus and plus: domes that catch a little red on their upper edge
    for (const [sel, x, sign] of [['.dec', 68, -1], ['.inc', 292, 1]]) {
      const b = this.$(sel), down = b.matches(':active');
      const g = ctx.createRadialGradient(x - 8, K.y - 10, 2, x, K.y, 32); g.addColorStop(0, down ? '#2a0a10' : '#1c0a0d'); g.addColorStop(1, '#070304');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, K.y, 30, 0, TAU); ctx.fill();
      const edge = ctx.createLinearGradient(x - 30, K.y - 30, x + 30, K.y + 30); edge.addColorStop(0, 'rgba(255,47,74,0.7)'); edge.addColorStop(0.5, 'rgba(255,47,74,0.08)'); edge.addColorStop(1, 'rgba(255,47,74,0.25)');
      ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, K.y, 30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = RED; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 9, K.y); ctx.lineTo(x + 9, K.y);
      if (sign > 0) { ctx.moveTo(x, K.y - 9); ctx.lineTo(x, K.y + 9); }
      ctx.stroke();
      if (b.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(x, K.y, 35, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, b, x - 33, K.y - 33, 66, 66);
    }
    // the knob: a fluted skirt and a cap with a mark, turned a tenth of a turn for each second
    const turn = pos * (TAU / 10);
    ctx.strokeStyle = 'rgba(255,47,74,0.7)'; ctx.lineWidth = 1.2; ctx.lineCap = 'butt'; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ctx.moveTo(K.x + Math.cos(a) * 49, K.y + Math.sin(a) * 49); ctx.lineTo(K.x + Math.cos(a) * (i % 4 ? 53 : 57), K.y + Math.sin(a) * (i % 4 ? 53 : 57)); }
    ctx.stroke();
    ctx.save(); ctx.translate(K.x, K.y); ctx.rotate(turn);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU, r = 40 + Math.cos(a * 20) * 2.2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fillStyle = '#12060a'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,47,74,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    const cap = ctx.createRadialGradient(K.x - 10, K.y - 12, 2, K.x, K.y, 30); cap.addColorStop(0, '#4a0f1a'); cap.addColorStop(0.5, '#1a070b'); cap.addColorStop(1, '#090304');
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(K.x, K.y, 29, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(K.x, K.y); ctx.rotate(turn);
    ctx.strokeStyle = RED; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -24); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(255,47,74,0.85)'; ctx.beginPath(); ctx.ellipse(K.x - 8, K.y - 11, 6, 2.6, -0.7, 0, TAU); ctx.fill();
    if (this.knob.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(K.x, K.y, 46, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.knob, K.x - 46, K.y - 46, 92, 92);
    return live;
  }
}
customElements.define('darkroom-timer', DarkroomTimer);
// #endregion darkroom-timer
