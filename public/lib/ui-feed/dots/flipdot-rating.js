// <flipdot-rating>: five radio inputs drawn as flip-dot stars on a disc panel.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, hit, rr, TAU, reduced } from '../kit.js';

// #region flipdot-rating
//   <flipdot-rating name="stars" value="3"></flipdot-rating>
// Five radio inputs. The canvas puts each one's hit region over a star and draws the stars as flip dots:
// a disc for each cell that turns over when its state changes.
const STAR = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.7 : 6.6, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const inside = (x, y, k) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = pts[i].map((v) => v * k), [xj, yj] = pts[j].map((v) => v * k); if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const full = [], ring = [];
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) { const a = inside(x - 6, y - 5.6, 1), b = inside(x - 6, y - 5.6, 0.52); full.push(a); ring.push(a && !b); }
  return { full, ring };
})();
const FONT = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', '/': '001001010100100' };

export class FlipdotRating extends FeedControl {
  static size = [360, 220];
  static html = [1, 2, 3, 4, 5].map((n) => `<input type="radio" name="r" value="${n}" aria-label="${n} of 5 stars">`).join('');
  static css = `input { width: 66px; height: 70px; opacity: 0; touch-action: manipulation; }`;
  static COLS = 72; static ROWS = 40;

  ready() {
    this.radios = this.$$('input');
    const C = FlipdotRating;
    this.phase = new Float32Array(C.COLS * C.ROWS);
    this.wait = new Float32Array(C.COLS * C.ROWS);
    this.target = new Uint8Array(C.COLS * C.ROWS);
    const v = +this.getAttribute('value');
    if (v) this.radios[v - 1].checked = true;
    this.shadowRoot.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.setValue(this.value);
    this.first = true;
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  set value(v) { this.radios.forEach((r) => { r.checked = r.value === String(v); }); this.setValue(this.value); this.request(); }
  layout() {
    const C = FlipdotRating, v = +this.value || 0, t = new Uint8Array(C.COLS * C.ROWS);
    for (let s = 0; s < 5; s++) {
      const shape = s < v ? STAR.full : STAR.ring;
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (shape[y * 13 + x]) t[(y + 5) * C.COLS + 2 + s * 14 + x] = 1;
    }
    const text = `${v}/5`;
    let cx = Math.round(C.COLS / 2 - (text.length * 8 - 2) / 2);
    for (const ch of text) {
      const g = FONT[ch];
      for (let i = 0; i < 15; i++) if (g[i] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) t[(24 + Math.floor(i / 3) * 2 + a) * C.COLS + cx + (i % 3) * 2 + b] = 1;
      cx += 8;
    }
    return t;
  }
  draw(ctx, w, h) {
    const C = FlipdotRating, g = (w - 16) / C.COLS, x0 = 8, y0 = (h - C.ROWS * g) / 2;
    const t = this.layout();
    for (let i = 0; i < t.length; i++) if (t[i] !== this.target[i]) { this.target[i] = t[i]; this.wait[i] = this.first || reduced() ? 0 : (i % C.COLS) * 0.006 + Math.random() * 0.05; }
    if (this.first) { this.phase.set(t); this.first = false; }
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    let moving = false;
    for (let y = 0; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
      const i = y * C.COLS + x;
      let p = this.phase[i];
      if (p !== this.target[i]) {
        moving = true;
        if (this.wait[i] > 0) this.wait[i] -= this.dt;
        else p = this.phase[i] = this.target[i] ? Math.min(1, p + this.dt * 7) : Math.max(0, p - this.dt * 7);
      }
      const cx = x0 + (x + 0.5) * g, cy = y0 + (y + 0.5) * g, sy = Math.abs(Math.cos(p * Math.PI));
      ctx.fillStyle = p > 0.5 ? '#e6e04a' : '#1e1e1e';
      ctx.beginPath();
      ctx.ellipse(cx, cy, g * 0.42, Math.max(0.3, g * 0.42 * sy), 0, 0, TAU);
      ctx.fill();
    }
    this.radios.forEach((r, s) => {
      const x = x0 + (1.5 + s * 14) * g, y = y0 + 4 * g;
      hit(ctx, r, x, y, 14 * g, 15 * g);
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; rr(ctx, x, y, 14 * g, 15 * g, 6); ctx.stroke(); }
    });
    return moving;
  }
}
customElements.define('flipdot-rating', FlipdotRating);
// #endregion flipdot-rating
