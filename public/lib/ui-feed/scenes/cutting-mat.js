// <cutting-mat>: a crop box over a painted still life, held by four range inputs and a drag surface.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, clamp, TAU } from '../kit.js';
import { cached } from '../fold.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const local = (el, e, size) => { const r = el.canvas.getBoundingClientRect(), k = r.width / size; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };

export class CuttingMat extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  // The picture, in design units, and how many design units make an inch of it.
  static PIC = { x: 34, y: 34, w: 292, h: 292, inch: 40 };
  static css = `
    .crop { width: 292px; height: 292px; touch-action: none; cursor: move; }
    .keys { width: 292px; display: flex; flex-wrap: wrap; }
    .keys label { display: block; width: 50%; font: 10px/1.4 ${SANS}; color: #fff; }
    .keys input { width: 100%; margin: 0; }
    output { width: max-content; padding: 3px 6px; background: #f6d33c; color: #111; font: 700 10.5px/1 ${MONO}; }`;

  ready() { this.build(); }

  // #region cutting-mat
  build() {
    const box = this.canvas ?? this.$('.plain'), P = CuttingMat.PIC;
    const [x, y, w, h] = (this.getAttribute('value') ?? '40 60 140 130').split(/[\s,]+/).map(Number);
    // Four ranges hold the box, in design units of the picture: the keys work on them, and they are what
    // the form sends. Their limits move with each other, so the box never leaves the picture.
    const r = (k, label, v) => `<label>${label}<input type="range" data-k="${k}" min="0" max="${P.w}" step="1" value="${v}"></label>`;
    this.keyset = node(`<div class="keys" role="group" aria-label="Crop">${r('x', 'Left', x)}${r('y', 'Top', y)}${r('w', 'Width', w)}${r('h', 'Height', h)}</div>`);
    this.range = Object.fromEntries([...this.keyset.querySelectorAll('input')].map((i) => [i.dataset.k, i]));
    this.grab = node('<div class="crop" aria-hidden="true"></div>');
    this.size = node('<output aria-live="polite"></output>');
    box.replaceChildren(this.keyset, this.grab, this.size);
    this.keyset.addEventListener('input', () => this.sync());
    // One element takes every drag over the picture. Where it starts says what it moves.
    let drag = null;
    this.grab.addEventListener('pointerdown', (e) => {
      const p = local(this, e, 360), b = this.box(), near = (a, v) => Math.abs(a - v) < 14;
      const ex = { l: near(p.x, P.x + b.x), r: near(p.x, P.x + b.x + b.w), t: near(p.y, P.y + b.y), b: near(p.y, P.y + b.y + b.h) };
      const inside = p.x > P.x + b.x && p.x < P.x + b.x + b.w && p.y > P.y + b.y && p.y < P.y + b.y + b.h;
      if (!ex.l && !ex.r && !ex.t && !ex.b && !inside) return;
      e.preventDefault(); try { this.grab.setPointerCapture(e.pointerId); } catch {}
      drag = { p, b, ex, move: !ex.l && !ex.r && !ex.t && !ex.b }; this.dragging = true; this.request();
    });
    this.grab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = local(this, e, 360), dx = p.x - drag.p.x, dy = p.y - drag.p.y, b = { ...drag.b }, min = 24;
      if (drag.move) { b.x = clamp(b.x + dx, 0, P.w - b.w); b.y = clamp(b.y + dy, 0, P.h - b.h); }
      if (drag.ex.l) { const nx = clamp(b.x + dx, 0, b.x + b.w - min); b.w += b.x - nx; b.x = nx; }
      if (drag.ex.r) b.w = clamp(b.w + dx, min, P.w - b.x);
      if (drag.ex.t) { const ny = clamp(b.y + dy, 0, b.y + b.h - min); b.h += b.y - ny; b.y = ny; }
      if (drag.ex.b) b.h = clamp(b.h + dy, min, P.h - b.y);
      this.set(b);
    });
    const end = () => { if (!drag) return; drag = null; this.dragging = false; this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); };
    this.grab.addEventListener('pointerup', end); this.grab.addEventListener('pointercancel', end);
    this.sync();
  }
  box() { const R = this.range; return { x: +R.x.value, y: +R.y.value, w: +R.w.value, h: +R.h.value }; }
  set(b) { const R = this.range; R.x.value = Math.round(b.x); R.y.value = Math.round(b.y); R.w.value = Math.round(b.w); R.h.value = Math.round(b.h); this.sync(); }
  sync() {
    const P = CuttingMat.PIC, R = this.range, b = this.box();
    // Each range's limit follows the others, so the keys can't push the box off the picture.
    R.x.max = P.w - b.w; R.y.max = P.h - b.h; R.w.min = R.h.min = 24; R.w.max = P.w - b.x; R.h.max = P.h - b.y;
    const inch = (v) => (v / P.inch).toFixed(1);
    this.size.textContent = `${inch(b.w)} × ${inch(b.h)} in`;
    for (const [k, i] of Object.entries(R)) i.setAttribute('aria-valuetext', `${inch(+i.value)} in`);
    this.setValue(`${inch(b.x)},${inch(b.y)},${inch(b.w)},${inch(b.h)}`);
    this.request();
  }

  draw(ctx, w, h) {
    const P = CuttingMat.PIC, b = this.box(), X = P.x + b.x, Y = P.y + b.y;
    ctx.drawImage(cached(this, 'mat', 360, 360, mat), 0, 0, w, h);
    ctx.drawImage(cached(this, 'still', P.w, P.h, stillLife), P.x, P.y, P.w, P.h);
    put(ctx, this.keyset, -1000, 0);
    // outside the box, the picture is dimmed; inside, thirds while it is being dragged
    ctx.save(); ctx.fillStyle = 'rgba(8,30,24,0.55)'; ctx.beginPath(); ctx.rect(P.x, P.y, P.w, P.h); ctx.rect(X, Y, b.w, b.h); ctx.fill('evenodd'); ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(X, Y, b.w, b.h);
    if (this.dragging) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); for (const k of [1, 2]) { ctx.moveTo(X + b.w * k / 3, Y); ctx.lineTo(X + b.w * k / 3, Y + b.h); ctx.moveTo(X, Y + b.h * k / 3); ctx.lineTo(X + b.w, Y + b.h * k / 3); } ctx.stroke(); }
    // the handles: L-shaped corners and short bars on the edges; the one whose range has focus is yellow
    const f = this.shadowRoot.activeElement?.dataset?.k, L = 12;
    const ink = (k) => (f === k ? '#f6d33c' : '#fff');
    ctx.lineWidth = 3.5; ctx.lineCap = 'square';
    const corner = (cx, cy, sx, sy, c) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke(); };
    corner(X, Y, 1, 1, f === 'x' || f === 'y' ? '#f6d33c' : '#fff'); corner(X + b.w, Y, -1, 1, ink('w')); corner(X, Y + b.h, 1, -1, ink('h')); corner(X + b.w, Y + b.h, -1, -1, f === 'w' || f === 'h' ? '#f6d33c' : '#fff');
    ctx.strokeStyle = ink('y'); ctx.beginPath(); ctx.moveTo(X + b.w / 2 - 8, Y); ctx.lineTo(X + b.w / 2 + 8, Y); ctx.stroke();
    ctx.strokeStyle = ink('h'); ctx.beginPath(); ctx.moveTo(X + b.w / 2 - 8, Y + b.h); ctx.lineTo(X + b.w / 2 + 8, Y + b.h); ctx.stroke();
    ctx.strokeStyle = ink('x'); ctx.beginPath(); ctx.moveTo(X, Y + b.h / 2 - 8); ctx.lineTo(X, Y + b.h / 2 + 8); ctx.stroke();
    ctx.strokeStyle = ink('w'); ctx.beginPath(); ctx.moveTo(X + b.w, Y + b.h / 2 - 8); ctx.lineTo(X + b.w, Y + b.h / 2 + 8); ctx.stroke();
    // the size, on a yellow tag above the box (below it when the box is at the top)
    const sw = this.size.offsetWidth, sh = this.size.offsetHeight, ty = Y - sh - 6 < P.y - 20 ? Y + b.h + 6 : Y - sh - 6;
    put(ctx, this.size, clamp(X, 4, w - sw - 4), ty);
    hit(ctx, this.grab, P.x, P.y, P.w, P.h);
    return false;
  }
  // #endregion cutting-mat
}
customElements.define('cutting-mat', CuttingMat);

function mat(g) {
  g.fillStyle = '#0f5a48'; g.fillRect(0, 0, 360, 360);
  g.strokeStyle = 'rgba(160,230,200,0.22)'; g.lineWidth = 0.6;
  for (let i = 0; i <= 360; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
  g.strokeStyle = 'rgba(190,240,215,0.4)'; g.lineWidth = 0.9;
  for (let i = 0; i <= 360; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
}
// The picture to crop, painted: a gingham cloth, a plate with orange halves, a cup of coffee, a lemon and a leaf.
function stillLife(g, w, h) {
  g.fillStyle = '#eef1f6'; g.fillRect(0, 0, w, h);
  const sq = w / 14;
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(48,78,150,0.55)'; g.fillRect(i * sq, 0, sq / 2, h); g.fillRect(0, i * sq, w, sq / 2); }
  for (let i = 0; i < 14; i++) for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(30,55,120,0.45)'; g.fillRect(i * sq, k * sq, sq / 2, sq / 2); }
  const shadow = (fn) => { g.save(); g.shadowColor = 'rgba(0,0,30,0.4)'; g.shadowBlur = 10; g.shadowOffsetY = 4; fn(); g.restore(); };
  shadow(() => { g.fillStyle = '#6f7d86'; g.beginPath(); g.arc(w * 0.38, h * 0.48, w * 0.32, 0, TAU); g.fill(); });
  g.fillStyle = '#f4efe3'; g.beginPath(); g.arc(w * 0.38, h * 0.48, w * 0.27, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#f08a1c'; g.beginPath(); g.arc(w * 0.27, h * 0.38, w * 0.105, 0, TAU); g.fill(); });
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(w * 0.25, h * 0.35, w * 0.04, 0, TAU); g.fill();
  g.fillStyle = '#2e6b2e'; g.beginPath(); g.arc(w * 0.3, h * 0.39, 2, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#f39c1e'; g.beginPath(); g.arc(w * 0.47, h * 0.56, w * 0.1, 0, TAU); g.fill(); });
  g.fillStyle = '#ffd16e'; g.beginPath(); g.arc(w * 0.47, h * 0.56, w * 0.082, 0, TAU); g.fill();
  g.strokeStyle = '#f39c1e'; g.lineWidth = 1.5; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.moveTo(w * 0.47, h * 0.56); g.lineTo(w * 0.47 + Math.cos(a) * w * 0.08, h * 0.56 + Math.sin(a) * w * 0.08); g.stroke(); }
  shadow(() => { g.fillStyle = '#7f8a91'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.13, 0, TAU); g.fill(); });
  g.fillStyle = '#e9e4da'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.1, 0, TAU); g.fill();
  g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.072, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#b8b23a'; g.beginPath(); g.ellipse(w * 0.75, h * 0.82, w * 0.12, w * 0.075, -0.3, 0, TAU); g.fill(); });
  shadow(() => { g.fillStyle = '#245a32'; g.beginPath(); g.ellipse(w * 0.14, h * 0.86, w * 0.1, w * 0.035, -0.5, 0, TAU); g.fill(); });
}
