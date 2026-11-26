// <coast-path>: a hand-drawn map with a <button> for each waypoint and a role="tooltip" card on a spring.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, spring, TAU } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// A hand that prints. The test browser has none of these, and falls back to its sans-serif rather than to a script.
const HAND = "'Patrick Hand', 'Gochi Hand', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', 'Comic Neue', ui-rounded, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// The coast, as points from the top left to the bottom right. The sea is below and to the left of it.
const COAST = [[-10, 84], [30, 104], [70, 132], [110, 170], [150, 206], [196, 238], [236, 268], [270, 300], [300, 334], [318, 372]];
const along = (pts, t) => { const n = pts.length - 1, i = Math.min(n - 1, Math.floor(t * n)), k = t * n - i; return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]; };

export class CoastPath extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    button.wp { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: transparent; font-size: 1px; cursor: pointer; }
    button.wp:focus-visible { outline: 0; }
    .tip { width: max-content; max-width: 250px; padding: 9px 12px 10px; background: #fffdf6; border: 2px solid #161616; box-shadow: 4px 4px 0 #161616; color: #161616; font-family: ${HAND}; }
    .tip small { display: block; font-size: 11px; letter-spacing: 0.04em; }
    .tip b { display: inline-block; margin: 2px 0 8px; font: 700 26px/1.05 ${HAND}; border-bottom: 2px solid #d4372c; }
    .tip dl { display: flex; margin: 0; }
    .tip dl div { padding: 0 9px; white-space: nowrap; border-left: 1.5px solid #161616; }
    .tip dl div:first-child { padding-left: 0; border: 0; }
    .tip dt { font: 400 21px/1 ${HAND}; }
    .tip dt i { font-style: normal; font-size: 12px; margin-left: 2px; }
    .tip dd { margin: 3px 0 0; font-size: 10px; }`;

  ready() {
    this.pop = { x: 0, v: 0 };
    this.build();
  }

  // #region coast-path
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.points = options(this).map((o) => ({ ...o, x: +o.data.x, y: +o.data.y }));
    this.tip = node('<div class="tip" role="tooltip" id="tip"></div>');
    this.buttons = this.points.map((p, i) => node(`<button class="wp" type="button" aria-describedby="tip" data-i="${i}">${esc(p.label)}</button>`));
    box.replaceChildren(...this.buttons, this.tip);
    this.shown = -1; this.pinned = -1;
    const show = (i) => { if (i === this.shown) return; this.shown = i; this.fill(i); this.pop.x = Math.min(this.pop.x, 0.2); this.request(); };
    this.buttons.forEach((b, i) => {
      b.addEventListener('pointerenter', () => show(i));
      b.addEventListener('pointerleave', () => show(this.pinned >= 0 ? this.pinned : this.shadowRoot.activeElement?.classList.contains('wp') ? +this.shadowRoot.activeElement.dataset.i : -1));
      b.addEventListener('focus', () => show(i));
      b.addEventListener('blur', () => { if (this.pinned !== i) show(this.pinned); });
      // A tap pins the card, so it stays when the finger lifts. A second tap lets it go.
      b.addEventListener('click', () => { this.pinned = this.pinned === i ? -1 : i; show(this.pinned >= 0 ? i : -1); });
    });
    // Escape hides the card, as a tooltip should (WCAG 1.4.13), without moving focus.
    this.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.shown >= 0) { this.pinned = -1; show(-1); } });
    this.tip.hidden = true;
  }
  fill(i) {
    const p = this.points[i];
    this.tip.hidden = i < 0;
    if (!p) return;
    const d = p.data;
    this.tip.innerHTML = `<small>${esc(d.note ?? '')}</small><b>${esc(p.label)}</b><dl><div><dt>${esc(d.km)}<i>km</i></dt><dd>${esc(d.from ?? 'from start')}</dd></div><div><dt>${esc(d.time)}</dt><dd>walking</dd></div><div><dt>↑${esc(d.climb)}<i>m</i></dt><dd>${esc(d.up ?? 'climbed')}</dd></div></dl>`;
  }

  draw(ctx, w, h) {
    ctx.drawImage(cached(this, 'map', 360, 360, (g) => drawMap(g, this.points)), 0, 0, w, h);
    const focus = this.shadowRoot.activeElement;
    this.points.forEach((p, i) => {
      const on = i === this.shown;
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? 7.5 : 6, 0, TAU);
      ctx.fillStyle = on ? '#d4372c' : '#fffdf6'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#161616'; ctx.stroke();
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, TAU); ctx.fillStyle = '#161616'; ctx.fill(); }
      if (focus === this.buttons[i]) { ctx.save(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, TAU); ctx.stroke(); ctx.restore(); }
      hit(ctx, this.buttons[i], p.x - 11, p.y - 11, 22, 22);
    });
    // The card springs out of the waypoint. It sits below and to one side, and above near the bottom.
    let moving = spring(this.pop, this.shown >= 0 ? 1 : 0, this.dt, 320, 20);
    if (this.shown >= 0 && this.pop.x > 0.02) {
      const p = this.points[this.shown], tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      const below = p.y + 28 + th < h - 8, tx = clamp(p.x - tw * 0.35, 8, w - tw - 12), ty = below ? p.y + 26 : p.y - 26 - th;
      const s = clamp(this.pop.x, 0, 1.2);
      // the stem, drawn first so the card covers its end
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + (below ? 8 : -8)); ctx.lineTo(p.x, lerp(p.y, below ? ty + 2 : ty + th - 2, Math.min(1, s))); ctx.stroke();
      ctx.save();
      ctx.globalAlpha = clamp(s * 2);
      ctx.translate(p.x, p.y); ctx.scale(s, s); ctx.translate(-p.x, -p.y);
      put(ctx, this.tip, tx, ty, tw, th);
      ctx.restore();
    } else hit(ctx, this.tip, -1000, 0);
    return moving;
  }
  // #endregion coast-path
}
customElements.define('coast-path', CoastPath);

// The map: squared paper, the sea, the cliffs hatched in ink, contours on the hills, two towns, the path.
function drawMap(g, pts) {
  g.fillStyle = '#f7f5ee'; g.fillRect(0, 0, 360, 360);
  g.strokeStyle = 'rgba(120,130,150,0.16)'; g.lineWidth = 0.5;
  for (let i = 0; i <= 360; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
  const ink = '#1b1b1b';
  // the normal of the coast, pointing inland (up and right)
  const inland = (t) => { const a = along(COAST, Math.max(0, t - 0.01)), b = along(COAST, Math.min(1, t + 0.01)), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; };
  // contours on the hills: wavy lines further and further inland
  g.strokeStyle = ink; g.lineCap = 'round';
  for (let c = 0; c < 9; c++) {
    const off = 46 + c * 21 + rnd(c) * 6;
    g.lineWidth = 0.7;
    for (let piece = 0; piece < 7; piece++) {
      const t0 = rnd(c * 9 + piece) * 0.9, len = 0.06 + rnd(c * 11 + piece) * 0.12;
      g.beginPath();
      for (let k = 0; k <= 12; k++) {
        const t = clamp(t0 + len * k / 12), [x, y] = along(COAST, t), [nx, ny] = inland(t), o = off + Math.sin(t * 40 + c) * 4;
        k ? g.lineTo(x + nx * o, y + ny * o) : g.moveTo(x + nx * o, y + ny * o);
      }
      g.stroke();
    }
  }
  // the cliffs: hatching across a band inland of the coast, cross-hatched where it is steepest
  for (let i = 0; i <= 300; i++) {
    const t = i / 300, [x, y] = along(COAST, t), [nx, ny] = inland(t), len = 30 + 26 * (0.5 + 0.5 * Math.sin(t * 13)) + rnd(i) * 10;
    g.lineWidth = 0.45 + rnd(i + 3) * 0.4;
    g.beginPath(); g.moveTo(x + rnd(i) - 0.5, y); g.lineTo(x + nx * len + (rnd(i + 1) - 0.5) * 4, y + ny * len); g.stroke();
    if (i % 2 === 0 && Math.sin(t * 17) > -0.2) { g.beginPath(); g.moveTo(x + nx * 4, y + ny * 4 + 6); g.lineTo(x + nx * len * 0.7 + 8, y + ny * len * 0.7 - 2); g.stroke(); }
  }
  // the coast line, and the sea as short strokes along it
  g.lineWidth = 2; g.beginPath(); COAST.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  g.lineWidth = 0.6;
  for (let r = 1; r < 4; r++) for (let i = 0; i < 18; i++) {
    const t = rnd(i * 7 + r), [x, y] = along(COAST, t), [nx, ny] = inland(t), o = -8 * r - rnd(i) * 6;
    g.beginPath(); g.moveTo(x + nx * o - ny * 5, y + ny * o + nx * 5); g.lineTo(x + nx * o + ny * 5, y + ny * o - nx * 5); g.stroke();
  }
  // the path, a red dashed line through the waypoints
  g.strokeStyle = '#d4372c'; g.lineWidth = 2.2; g.setLineDash([5, 4]);
  g.beginPath();
  pts.forEach((p, i) => { if (!i) return g.moveTo(p.x, p.y); const q = pts[i - 1], mx = (p.x + q.x) / 2 + (rnd(i) - 0.5) * 18, my = (p.y + q.y) / 2 + (rnd(i + 5) - 0.5) * 18; g.quadraticCurveTo(mx, my, p.x, p.y); });
  g.stroke(); g.setLineDash([]);
  // the towns at each end: little blocks of houses, and their names in capitals
  const town = (x, y) => { g.save(); g.translate(x, y); g.rotate(-0.6); g.strokeStyle = ink; g.lineWidth = 0.8; for (let i = 0; i < 9; i++) { const bx = (i % 3) * 7 - 10, by = Math.floor(i / 3) * 7 - 10; g.strokeRect(bx, by, 5.5, 5.5); g.beginPath(); for (let k = 1; k < 5; k++) { g.moveTo(bx, by + k * 1.1); g.lineTo(bx + 5.5, by + k * 1.1); } g.stroke(); } g.restore(); };
  for (const p of pts) if (p.data.town !== undefined) town(p.x + (+p.data.tx || -14), p.y + (+p.data.ty || -16));
  g.fillStyle = ink; g.font = `400 15px ${HAND}`;
  const caps = (s, x, y) => { g.save(); g.letterSpacing = '3px'; g.fillText(s.toUpperCase(), x, y); g.restore(); };
  for (const p of pts) if (p.data.town !== undefined) caps(p.label, p.x + (+p.data.lx || 18), p.y + (+p.data.ly || 5));
  // the scale bar and north
  g.strokeStyle = ink; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(254, 26); g.lineTo(322, 26); g.moveTo(254, 21); g.lineTo(254, 31); g.moveTo(322, 21); g.lineTo(322, 31); g.stroke();
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(254 + i * 6.8, 26); g.lineTo(254 + i * 6.8, 22); g.stroke(); }
  g.font = `400 11px ${HAND}`; g.fillText('0', 251, 42); g.fillText('500 m', 305, 42);
  g.beginPath(); g.moveTo(336, 58); g.lineTo(346, 26); g.moveTo(341, 31); g.lineTo(346, 26); g.lineTo(349, 33); g.stroke();
  g.fillText('N', 344, 20);
}
