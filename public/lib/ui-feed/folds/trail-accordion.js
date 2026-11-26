// <trail-accordion>: coast path accordion of <details>, one leg always open with an unfolding contour map.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, smooth, TAU } from '../kit.js';
import { Fold, wire, cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";

// #region trail-map
// A made-up contour map for one leg: a height for every point, isolines by marching squares, woods where
// a second function is high, a coastline, and the path a little way inland.
function drawTrailMap(g, leg, seed, W = 360, H = 208) {
  const GREEN = '#0b6a3c', RED = '#e8301c';
  const coast = (x) => 172 + 13 * Math.sin(x * 0.013 + seed) + 7 * Math.sin(x * 0.031 + seed * 2.3);
  const hills = [0, 1, 2, 3, 4].map((k) => ({ x: 30 + rnd(seed * 7 + k) * 300, y: 14 + rnd(seed * 3 + k + 10) * 96, a: 50 + rnd(seed + k + 20) * 150, r: 30 + rnd(seed * 5 + k + 30) * 34 }));
  const height = (x, y) => {
    const inland = coast(x) - y;
    if (inland < 0) return inland;
    let z = inland * 1.25 + 14 * Math.sin(x * 0.05 + seed) * Math.sin(y * 0.06 + seed * 1.3) + 8 * Math.sin(x * 0.11 + y * 0.07 + seed);
    for (const p of hills) z += p.a * Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * p.r * p.r));
    return Math.max(z * smooth(inland / 14), 0.5);
  };
  const wood = (x, y) => Math.sin(x * 0.035 + seed * 2) * Math.sin(y * 0.05 - seed) + 0.5 * Math.sin(x * 0.08 + y * 0.03 + seed);

  g.fillStyle = '#f4f6ef'; g.fillRect(0, 0, W, H);
  // woods: a wash and a dot for each small square of it
  for (let y = 1.5; y < H; y += 3) for (let x = 1.5 + ((y / 3) % 2) * 1.5; x < W; x += 3) {
    if (coast(x) - y < 7 || wood(x, y) < 0.42) continue;
    g.fillStyle = 'rgba(11,106,60,0.13)'; g.fillRect(x - 1.5, y - 1.5, 3, 3);
    g.fillStyle = 'rgba(11,106,60,0.75)'; g.fillRect(x - 0.35, y - 0.35, 0.7, 0.7);
  }
  // the grid of the sheet
  g.fillStyle = 'rgba(11,106,60,0.16)';
  for (let x = 60; x < W; x += 60) g.fillRect(x, 0, 0.5, H);
  for (let y = 52; y < H; y += 52) g.fillRect(0, y, W, 0.5);

  // contours: one value for each corner of a grid, then a line across every square that a level passes through
  const S = 3, nx = Math.ceil(W / S), ny = Math.ceil(H / S), z = new Float32Array((nx + 1) * (ny + 1));
  let top = 0;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const v = z[j * (nx + 1) + i] = height(i * S, j * S); if (v > top) top = v; }
  g.strokeStyle = GREEN; g.lineCap = 'round';
  for (let level = 12, n = 1; level < top; level += 12, n++) {
    g.lineWidth = n % 5 ? 0.45 : 0.95; g.globalAlpha = n % 5 ? 0.62 : 0.85; g.beginPath();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = z[j * (nx + 1) + i], b = z[j * (nx + 1) + i + 1], c = z[(j + 1) * (nx + 1) + i + 1], d = z[(j + 1) * (nx + 1) + i];
      const k = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
      if (k === 0 || k === 15) continue;
      const x = i * S, y = j * S, f = (p, q) => (level - p) / (q - p) * S;
      const T = [x + f(a, b), y], R = [x + S, y + f(b, c)], B = [x + f(d, c), y + S], L = [x, y + f(a, d)];
      const seg = (p, q) => { g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); };
      switch (k) {
        case 1: case 14: seg(L, T); break;
        case 2: case 13: seg(T, R); break;
        case 3: case 12: seg(L, R); break;
        case 4: case 11: seg(R, B); break;
        case 6: case 9: seg(T, B); break;
        case 7: case 8: seg(L, B); break;
        case 5: seg(L, T); seg(R, B); break;
        case 10: seg(T, R); seg(L, B); break;
      }
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // the shore, and the lines that follow it out to sea
  [[0, 1.3, 1], [4.5, 0.8, 0.8], [9, 0.55, 0.6], [15, 0.45, 0.4], [23, 0.4, 0.25]].forEach(([off, width, alpha]) => {
    g.globalAlpha = alpha; g.lineWidth = width; g.beginPath();
    for (let x = -2; x <= W + 2; x += 3) g.lineTo(x, coast(x) + off);
    g.stroke();
  });
  g.globalAlpha = 1;

  // the path: it keeps inland of the shore and rises over the ground in the middle of the leg
  const X0 = 30, X1 = 330, way = (x) => coast(x) - 15 - 34 * Math.sin(((x - X0) / (X1 - X0)) * Math.PI) ** 2 * (0.6 + 0.4 * Math.sin(x * 0.02 + seed * 3)) - 5 * Math.sin(x * 0.05 + seed);
  const pts = []; for (let x = X0; x <= X1; x += 2) pts.push([x, way(x)]);
  const line = () => { g.beginPath(); pts.forEach(([x, y]) => g.lineTo(x, y)); g.stroke(); };
  g.lineJoin = 'round'; g.strokeStyle = '#f4f6ef'; g.lineWidth = 4.4; line();
  g.strokeStyle = RED; g.lineWidth = 2.2; line();
  let length = 0; const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const km = Number(leg.km) || 10, perKm = length / km;
  g.lineWidth = 0.9;
  for (let k = 1, i = 1; k < km; k++) {                          // a tick across the path at each kilometre
    while (i < pts.length - 1 && along[i] < k * perKm) i++;
    const [x, y] = pts[i], [px, py] = pts[i - 1], n = Math.hypot(x - px, y - py) || 1, ux = -(y - py) / n * 3.6, uy = (x - px) / n * 3.6;
    g.beginPath(); g.moveTo(x - ux, y - uy); g.lineTo(x + ux, y + uy); g.stroke();
  }
  g.font = `700 8.5px ${COND}`; g.textBaseline = 'middle';
  for (const [end, name, align] of [[pts[0], leg.from, 'left'], [pts.at(-1), leg.to, 'right']]) {
    const [x, y] = end;
    g.fillStyle = GREEN;
    for (let i = 0; i < 6; i++) g.fillRect(x + (rnd(seed + i + x) - 0.5) * 30, y - 9 + (rnd(seed * 2 + i + x) - 0.5) * 12, 2, 2);   // houses
    g.fillStyle = '#f4f6ef'; g.strokeStyle = RED; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 5.2, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = RED; g.beginPath(); g.arc(x, y, 1.7, 0, TAU); g.fill();
    g.fillStyle = GREEN; g.textAlign = align;
    const text = String(name ?? '').toUpperCase(), lx = align === 'left' ? 9 : W - 9, tw = g.measureText(text).width;
    g.save(); g.fillStyle = 'rgba(244,246,239,0.8)'; g.fillRect(align === 'left' ? lx - 2 : lx - tw - 2, y + 13, tw + 4, 11); g.restore();
    g.fillText(text, lx, y + 19);
  }
  // spot heights on the three highest hills
  g.font = `700 6px ${COND}`; g.textAlign = 'left';
  for (const p of [...hills].sort((p, q) => height(q.x, q.y) - height(p.x, p.y)).slice(0, 3)) {
    const v = Math.round(height(p.x, p.y)); if (v < 40) continue;
    g.fillStyle = '#f4f6ef'; g.fillRect(p.x - 3, p.y - 4, 18, 8);
    g.fillStyle = GREEN; g.beginPath(); g.arc(p.x, p.y, 1.1, 0, TAU); g.fill(); g.fillText(String(v), p.x + 3, p.y + 0.5);
  }
  // the scale, from the length of the drawn path
  const sx = 126, sy = 199;
  g.fillStyle = 'rgba(244,246,239,0.85)'; g.fillRect(sx - 6, sy - 13, perKm * 2 + 34, 18);
  g.fillStyle = GREEN; g.fillRect(sx, sy - 1.6, perKm * 2, 3.2);
  g.fillStyle = '#f4f6ef'; g.fillRect(sx + perKm * 0.5, sy - 0.8, perKm * 0.5, 1.6); g.fillRect(sx + perKm * 1.5, sy - 0.8, perKm * 0.5, 1.6);
  g.fillStyle = GREEN; g.textAlign = 'center';
  ['0', '1', '2'].forEach((t, i) => g.fillText(t, sx + perKm * i, sy - 7));
  g.textAlign = 'left'; g.fillText('KM', sx + perKm * 2 + 6, sy);
}
// #endregion trail-map

export class TrailAccordion extends FeedControl {
  static size = [360, 384];
  static radius = 4;
  static BAR = 26; static ROW = 30; static MAP = 208;
  static css = `
    .total, summary { display: grid; grid-template-columns: 40px 198px 62px 60px; align-items: center; width: 360px; margin: 0; box-sizing: border-box;
      font: 700 11px/1 ${COND}; font-stretch: condensed; text-transform: uppercase; white-space: nowrap; overflow: hidden; }
    .total { height: 26px; color: #fff; }
    details { width: 360px; }
    summary { height: 30px; color: #0b6a3c; cursor: pointer; touch-action: manipulation; outline: none; }
    summary::-webkit-details-marker { display: none; }
    .n { font-size: 25px; padding-left: 9px; letter-spacing: -0.02em; }
    .total .n { font-size: 17px; }
    .km, .up { text-align: right; padding-right: 9px; font-size: 13px; }
    .km small, .up small { font-size: 8px; margin-left: 2px; }
    .up::before { content: '↑'; font-size: 8px; margin-right: 3px; vertical-align: 5px; }
    figure { margin: 0; width: 360px; height: 208px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'data-from', 'data-to', 'data-km', 'data-climb'] });
    this.addEventListener('feed-plain', () => this.folds.forEach((f) => { f.d.name = 'leg'; }));
  }
  attributeChangedCallback(_, __, v) { if (this.folds && v !== null && v !== this.value) this.value = v; }
  // #region trail-accordion
  build() {
    const legs = this.legs = options(this).map((o, i) => ({ value: o.value || String(i + 1), from: o.data.from ?? '', to: o.data.to ?? '', km: Number(o.data.km) || 0, climb: Number(o.data.climb) || 0 }));
    const was = this.folds ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    for (const f of this.folds ?? []) f.d.remove();
    this.head?.remove(); this.pictures?.clear();
    const row = (n, from, to, km, up) => `<span class="n">${esc(n)}</span><span>${esc(from)} — ${esc(to)}</span><span class="km">${km.toFixed(1)}<small>km</small></span><span class="up">${up}<small>m</small></span>`;
    this.head = document.createElement('p'); this.head.className = 'total'; this.head.setAttribute('drawable', '');
    this.head.innerHTML = legs.length ? row(`1–${legs.length}`, legs[0].from, legs.at(-1).to, legs.reduce((s, l) => s + l.km, 0), legs.reduce((s, l) => s + l.climb, 0)) : '';
    box.append(this.head);
    let open = Math.max(0, legs.findIndex((l) => l.value === was));
    this.folds = legs.map((l, i) => {
      const d = document.createElement('details');
      d.setAttribute('drawable', ''); d.open = i === open;
      d.innerHTML = `<summary>${row(l.value, l.from, l.to, l.km, l.climb)}</summary><figure role="img" aria-label="Map of leg ${esc(l.value)}, ${esc(l.from)} to ${esc(l.to)}: ${l.km.toFixed(1)} kilometres with ${l.climb} metres of climb"></figure>`;
      box.append(d);
      return new Fold(this, d, 0.5);
    });
    wire(this, this.folds); this.sync();
  }
  get index() { return Math.max(0, this.folds.findIndex((f) => f.open)); }
  get value() { return this.legs[this.index]?.value ?? ''; }
  set value(v) { const i = this.legs.findIndex((l) => l.value === String(v)); if (i >= 0) { this.folds.forEach((f, j) => f.set(j === i)); this.sync(); } }
  sync() {
    // The open leg cannot be closed, so its summary says so and takes no click.
    this.folds.forEach((f) => f.d.firstElementChild.setAttribute('aria-disabled', String(f.open)));
    this.setValue(this.value);
  }
  opened(f) { for (const g of this.folds) if (g !== f) g.set(false); }
  pick(i) {
    if (this.folds[i].open) return;                    // one leg is always open
    this.folds.forEach((f, j) => f.set(j === i));
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  draw(ctx, w) {
    const { BAR, ROW, MAP } = TrailAccordion;
    let moving = false, y = BAR;
    for (const f of this.folds) moving = f.step(this.dt) || moving;
    ctx.fillStyle = '#0b6a3c'; ctx.fillRect(0, 0, w, BAR);
    put(ctx, this.head, 0, 0);
    this.folds.forEach((f, i) => {
      const e = f.e, body = MAP * e;
      ctx.fillStyle = '#f4f6ef'; ctx.fillRect(0, y, w, ROW + body);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, ROW + body); ctx.clip();
      put(ctx, f.d, 0, y);
      ctx.restore();
      if (f.t > 0) {
        // the red band comes across from the left, and the summary is drawn again in white where the band is
        ctx.save(); ctx.beginPath(); ctx.rect(0, y, w * e, ROW); ctx.clip();
        ctx.fillStyle = '#ee3320'; ctx.fillRect(0, y, w, ROW);
        ctx.filter = 'brightness(0) invert(1)'; put(ctx, f.d, 0, y);
        ctx.restore();
        // the map is on four panels of paper, folded flat when the leg is closed
        const map = cached(this, i, w, MAP, (g) => drawTrailMap(g, this.legs[i], 1.7 * i + 0.6)), panels = 4, ph = MAP / panels, sh = map.height / panels;
        for (let p = 0; p < panels; p++) {
          const dy = y + ROW + p * ph * e;
          ctx.drawImage(map, 0, p * sh, map.width, sh, 0, dy, w, ph * e + 0.3);
          if (e < 1) {                                  // panels that face away from the light are darker
            const shade = ctx.createLinearGradient(0, dy, 0, dy + ph * e), dark = (1 - e) * (p % 2 ? 0.34 : 0.1);
            shade.addColorStop(0, `rgba(6,50,30,${p % 2 ? dark : dark * 0.4})`); shade.addColorStop(1, `rgba(6,50,30,${p % 2 ? dark * 0.5 : dark})`);
            ctx.fillStyle = shade; ctx.fillRect(0, dy, w, ph * e + 0.3);
          }
        }
      } else this.pictures?.delete(i);                  // a closed leg keeps no map
      ctx.fillStyle = '#0b6a3c'; ctx.fillRect(0, y, w, 0.7);
      ctx.fillStyle = f.t > 0 && e > 240 / 360 ? 'rgba(255,255,255,0.5)' : 'rgba(11,106,60,0.55)'; ctx.fillRect(238, y, 0.6, ROW);
      if (f.d.firstElementChild.matches(':focus-visible')) focusRing(ctx, 3, y + 3, w - 6, ROW - 6, f.open ? '#fff' : '#0b6a3c');
      y += ROW + body;
    });
    return moving;
  }
  // #endregion trail-accordion
}
customElements.define('trail-accordion', TrailAccordion);
