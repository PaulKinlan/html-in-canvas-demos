// ui-feed/folds.js: five controls that open, close or change panel, rebuilt from demos on ui-feed.dev.
//
//   <note-accordion name>      <details> for each <option>, one open at a time, beside a drawn bottle
//   <trail-accordion name>     <details> for each leg of a walk. The open one unfolds a contour map
//   <order-summary name>       one <details>. Its pictures go from a row to a column as it opens
//   <bus-tabs name value>      radios for the days, and a timetable (<dl>) for each that slides across
//   <poster-tabs name value>   radios for a period, and an <output> stretched to fill the poster
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /disclosure-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, easeOut, rr, spring, TAU, reduced } from './kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Didot', 'Bodoni MT', 'Bodoni 72', 'Playfair Display', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";
const money = (n, sign = '€') => sign + Number(n).toFixed(2);

// #region fold
// A <details> that the canvas opens and closes over time.
//
// A closed <details> has no content in its picture, so a close cannot be drawn after the element has
// closed. The click on the <summary> is cancelled, the canvas draws less and less of the picture, and the
// `open` attribute is removed when nothing of the content is left. An open sets the attribute at once.
class Fold {
  constructor(ctrl, details, seconds = 0.36) {
    this.ctrl = ctrl; this.d = details; this.seconds = seconds;
    this.t = this.want = details.open ? 1 : 0;      // how far open it is drawn, and where it is going
    this.h = 0;                                      // the height of the content, measured while it is open
    this.dom = details.open;                         // the state this object last gave the element
    // Opened or closed by something else: find in page, a script, or the plain fallback.
    details.addEventListener('toggle', () => {
      if (details.open === this.dom) return;
      this.dom = details.open; this.t = this.want = details.open ? 1 : 0;
      if (details.open) ctrl.opened?.(this);
      ctrl.sync?.(); ctrl.request();
    });
  }
  get open() { return this.want === 1; }
  set(open) {
    if (open && !this.d.open) this.d.open = this.dom = true;
    this.want = open ? 1 : 0;
    this.ctrl.request();
  }
  // Called once a frame. True while it is still moving.
  step(dt) {
    if (this.t !== this.want) {
      const by = reduced() ? 1 : dt / this.seconds;
      this.t = this.want ? Math.min(1, this.t + by) : Math.max(0, this.t - by);
    }
    if (this.t === 0 && this.dom) this.d.open = this.dom = false;     // not when something else has just opened it
    if (this.d.open) this.h = this.d.offsetHeight - this.d.firstElementChild.offsetHeight;
    return this.t !== this.want;
  }
  get e() { return smooth(this.t); }
}
// The summary of each fold calls pick(i) instead of toggling its <details>.
function wire(ctrl, folds) {
  folds.forEach((f, i) => f.d.firstElementChild.addEventListener('click', (e) => {
    if (ctrl.plain) return;                           // as plain HTML the element toggles itself
    e.preventDefault(); ctrl.pick(i);
  }));
}
// #endregion fold

function focusRing(ctx, x, y, w, h, colour = '#fff') {
  ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, x, y, w, h, 4); ctx.stroke(); ctx.restore();
}
// A picture that does not change, drawn once on a plain canvas at the control's own scale.
function cached(ctrl, key, w, h, draw) {
  const store = ctrl.pictures ??= new Map(), px = ctrl.px;
  let c = store.get(key);
  if (!c || c.px !== px) {
    c = { px, canvas: c?.canvas ?? document.createElement('canvas') };
    c.canvas.width = Math.ceil(w * px); c.canvas.height = Math.ceil(h * px);
    const g = c.canvas.getContext('2d');
    g.scale(px, px); draw(g, w, h);
    store.set(key, c);
  }
  return c.canvas;
}

// ---------------------------------------------------------------------------------------------------------
// Fragrance notes: an accordion of <details>, one open at a time.
// ---------------------------------------------------------------------------------------------------------

function drawBottle(g) {
  // the wall, the floor and the light that comes through the bottle onto the floor
  const wall = g.createLinearGradient(0, 0, 360, 280); wall.addColorStop(0, '#a3001f'); wall.addColorStop(1, '#8e001b');
  g.fillStyle = wall; g.fillRect(0, 0, 360, 360);
  const floor = g.createLinearGradient(0, 268, 0, 360); floor.addColorStop(0, '#b00a22'); floor.addColorStop(1, '#a00520');
  g.fillStyle = floor; g.fillRect(0, 276, 360, 84);
  const edge = g.createLinearGradient(0, 262, 0, 290); edge.addColorStop(0, 'rgba(142,0,27,1)'); edge.addColorStop(1, 'rgba(142,0,27,0)');
  g.fillStyle = edge; g.fillRect(0, 262, 360, 28);
  g.save();
  g.filter = 'blur(6px)'; g.fillStyle = 'rgba(48,0,10,0.7)';
  g.beginPath(); g.moveTo(214, 290); g.lineTo(328, 292); g.lineTo(236, 326); g.lineTo(40, 338); g.lineTo(12, 318); g.lineTo(110, 290); g.closePath(); g.fill();
  // caustics: thin bright curves fanned out from under the base, crossing each other
  g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  const pool = g.createRadialGradient(150, 311, 2, 150, 311, 70); pool.addColorStop(0, 'rgba(255,150,30,0.5)'); pool.addColorStop(1, 'rgba(255,90,0,0)');
  g.filter = 'blur(3px)'; g.fillStyle = pool; g.beginPath(); g.ellipse(150, 311, 74, 14, -0.06, 0, TAU); g.fill();
  g.filter = 'blur(1.3px)';
  for (let i = 0; i < 46; i++) {
    const x0 = 224 - rnd(i + 9) * 34, y0 = 299 + rnd(i + 3) * 8, len = 46 + rnd(i + 40) * 120, lift = (rnd(i + 21) - 0.35) * 26, bend = (rnd(i + 31) - 0.5) * 30;
    g.strokeStyle = `rgba(255,${130 + Math.round(rnd(i + 7) * 110)},${20 + Math.round(rnd(i + 17) * 50)},${0.16 + rnd(i + 5) * 0.34})`; g.lineWidth = 0.5 + rnd(i + 11) ** 2 * 2.2;
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 - len * 0.5, y0 + 6 + bend, x0 - len, y0 + 10 + lift); g.stroke();
  }
  g.restore();

  // glass: an eight-sided block with a thick base, and the perfume inside it
  const block = (x, y, w, h, c) => { g.beginPath(); g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c); g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c); g.closePath(); };
  const X = 206, Y = 112, W = 124, H = 184, L = { x: X + 11, y: Y + 32, w: W - 22, h: H - 45 };
  const glass = g.createLinearGradient(X, 0, X + W, 0);
  for (const [at, c] of [[0, 'rgba(255,226,214,0.78)'], [0.05, 'rgba(150,20,30,0.5)'], [0.1, 'rgba(255,240,232,0.5)'], [0.5, 'rgba(255,214,200,0.3)'], [0.9, 'rgba(255,225,210,0.36)'], [0.95, 'rgba(80,0,10,0.55)'], [1, 'rgba(255,205,190,0.6)']]) glass.addColorStop(at, c);
  g.fillStyle = glass; block(X, Y, W, H, 13); g.fill();
  const amber = g.createLinearGradient(L.x, 0, L.x + L.w, 0);
  for (const [at, c] of [[0, '#8a2c00'], [0.1, '#d06708'], [0.28, '#f59a18'], [0.5, '#ffb92e'], [0.74, '#ee8610'], [0.9, '#a94502'], [1, '#742200']]) amber.addColorStop(at, c);
  g.fillStyle = amber; block(L.x, L.y, L.w, L.h, 9); g.fill();
  g.save(); block(L.x, L.y, L.w, L.h, 9); g.clip();
  const depth = g.createLinearGradient(0, L.y, 0, L.y + L.h); depth.addColorStop(0, 'rgba(255,226,130,0.4)'); depth.addColorStop(0.3, 'rgba(255,200,90,0)'); depth.addColorStop(1, 'rgba(96,22,0,0.62)');
  g.fillStyle = depth; g.fillRect(L.x, L.y, L.w, L.h);
  // the facets of the block seen through the perfume
  g.fillStyle = 'rgba(92,24,0,0.34)'; g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(L.x + 15, L.y + 12); g.lineTo(L.x + 15, L.y + L.h - 12); g.lineTo(L.x, L.y + L.h); g.fill();
  g.fillStyle = 'rgba(60,10,0,0.42)'; g.beginPath(); g.moveTo(L.x + L.w, L.y); g.lineTo(L.x + L.w - 15, L.y + 12); g.lineTo(L.x + L.w - 15, L.y + L.h - 12); g.lineTo(L.x + L.w, L.y + L.h); g.fill();
  g.fillStyle = 'rgba(70,14,0,0.3)'; g.beginPath(); g.moveTo(L.x, L.y + L.h); g.lineTo(L.x + 15, L.y + L.h - 12); g.lineTo(L.x + L.w - 15, L.y + L.h - 12); g.lineTo(L.x + L.w, L.y + L.h); g.fill();
  g.strokeStyle = 'rgba(255,214,140,0.5)'; g.lineWidth = 0.6; g.strokeRect(L.x + 15, L.y + 12, L.w - 30, L.h - 24);
  const glow = g.createRadialGradient(X + W / 2 - 6, L.y + L.h * 0.52, 4, X + W / 2 - 6, L.y + L.h * 0.52, 62); glow.addColorStop(0, 'rgba(255,226,120,0.7)'); glow.addColorStop(1, 'rgba(255,170,30,0)');
  g.fillStyle = glow; g.fillRect(L.x, L.y, L.w, L.h);
  const streak = g.createLinearGradient(L.x + 17, 0, L.x + 31, 0); streak.addColorStop(0, 'rgba(255,255,255,0)'); streak.addColorStop(0.5, 'rgba(255,250,225,0.5)'); streak.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = streak; g.fillRect(L.x + 17, L.y + 14, 14, L.h - 30);
  g.restore();
  g.fillStyle = 'rgba(255,236,180,0.75)'; g.fillRect(L.x + 6, L.y, L.w - 12, 1.3);                  // the surface of the perfume
  g.fillStyle = 'rgba(255,255,255,0.13)'; block(X + 11, Y + 10, W - 22, 22, 7); g.fill();           // the air above it
  g.lineWidth = 1.1; g.strokeStyle = 'rgba(255,244,236,0.8)'; block(X + 0.5, Y + 0.5, W - 1, H - 1, 13); g.stroke();
  g.lineWidth = 0.7; g.strokeStyle = 'rgba(255,225,190,0.5)'; block(X + 11, Y + 10, W - 22, H - 24, 9); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.8; g.beginPath();
  for (const [ax, ay, bx, by] of [[X + 13, Y, X + 20, Y + 10], [X + W - 13, Y, X + W - 20, Y + 10], [X, Y + 13, X + 11, Y + 19], [X + W, Y + 13, X + W - 11, Y + 19], [X, Y + H - 13, X + 11, Y + H - 23], [X + W, Y + H - 13, X + W - 11, Y + H - 23]]) { g.moveTo(ax, ay); g.lineTo(bx, by); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(X + 3.2, Y + 18, 1.3, H - 40);                // light down the near edge
  const base = g.createLinearGradient(0, Y + H - 13, 0, Y + H); base.addColorStop(0, 'rgba(255,196,120,0.75)'); base.addColorStop(0.5, 'rgba(255,240,220,0.5)'); base.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = base; g.fillRect(X + 13, Y + H - 13, W - 26, 12);
  // neck, collar and cap
  const neck = g.createLinearGradient(X + 44, 0, X + 80, 0); neck.addColorStop(0, 'rgba(255,235,228,0.75)'); neck.addColorStop(0.3, 'rgba(255,200,190,0.3)'); neck.addColorStop(1, 'rgba(255,225,215,0.55)');
  g.fillStyle = neck; g.fillRect(X + 44, Y - 14, 36, 16);
  g.fillStyle = '#17171a'; rr(g, X + 39, Y - 21, 46, 10, 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(X + 43, Y - 19, 5, 6);
  const cap = g.createLinearGradient(X + 30, 0, X + 94, 0);
  for (const [at, c] of [[0, '#050506'], [0.1, '#34343a'], [0.2, '#0b0b0d'], [0.8, '#0a0a0c'], [0.93, '#2a2a30'], [1, '#040405']]) cap.addColorStop(at, c);
  g.fillStyle = cap; rr(g, X + 30, Y - 62, 64, 43, 2.5); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(X + 31, Y - 61.5, 62, 1.2);
}

export class NoteAccordion extends FeedControl {
  static size = [360, 360];
  static css = `
    details { width: 218px; }
    summary { display: block; height: 63px; padding-left: 19px; font: 400 60px/64px ${SERIF}; letter-spacing: -0.015em; color: #fff; cursor: pointer; touch-action: manipulation; outline: none; }
    summary::-webkit-details-marker { display: none; }
    .notes { margin: 0; padding: 3px 0 11px 20px; font: italic 400 25px/29px ${SERIF}; color: #ffb545; }
    .notes span { display: block; white-space: nowrap; }`;
  static TOP = 17;

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, characterData: true });
    this.addEventListener('feed-plain', () => this.folds.forEach((f) => { f.d.name = 'notes'; }));
  }
  // #region note-accordion
  build() {
    const was = this.value, items = options(this);
    for (const f of this.folds ?? []) f.d.remove();
    this.folds = items.map((o) => {
      const d = document.createElement('details');
      d.setAttribute('drawable', ''); d.dataset.value = o.value; d.open = was ? o.value === was : o.selected;
      d.innerHTML = `<summary>${esc(o.label)}</summary><p class="notes">${(o.data.notes ?? '').split('|').map((n) => `<span>${esc(n.trim())}</span>`).join('')}</p>`;
      (this.canvas ?? this.$('.plain')).append(d);
      return new Fold(this, d);
    });
    let seen = false;
    for (const f of this.folds) { if (f.open && seen) { f.d.open = f.dom = false; f.t = f.want = 0; } seen ||= f.open; }
    wire(this, this.folds); this.sync();
  }
  get value() { return this.folds?.find((f) => f.open)?.d.dataset.value ?? ''; }
  set value(v) { this.folds.forEach((f) => f.set(f.d.dataset.value === v)); this.sync(); }
  sync() { this.setValue(this.value || null); }
  opened(f) { for (const g of this.folds) if (g !== f) g.set(false); }
  // One section is open at a time, and the open one can be closed.
  pick(i) {
    this.folds.forEach((f, j) => f.set(j === i ? !f.open : false));
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  draw(ctx, w, h) {
    let moving = false, y = NoteAccordion.TOP;
    for (const f of this.folds) moving = f.step(this.dt) || moving;
    ctx.drawImage(cached(this, 'bottle', w, h, drawBottle), 0, 0, w, h);
    const rule = (at) => { ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillRect(0, at, 204, 0.8); ctx.fillRect(332, at, 28, 0.8); };
    for (const f of this.folds) {
      const head = f.d.firstElementChild, body = f.h * f.e;
      rule(y);
      // The whole <details> is drawn, clipped to as much of its content as is open so far. Its hit region is
      // the whole element, and the section drawn after it takes the part that is hidden.
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, 218, 63 + body); ctx.clip();
      put(ctx, f.d, 0, y);
      if (f.t < 1 && f.t > 0) { ctx.fillStyle = `rgba(153,0,29,${1 - f.e})`; ctx.fillRect(0, y + 63, 204, body); }   // the notes come up out of the red
      ctx.restore();
      // the plus sign turns and loses its upright as the section opens
      ctx.save(); ctx.translate(183, y + 32); ctx.rotate(f.e * Math.PI); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8 * (1 - f.e)); ctx.lineTo(0, 8 * (1 - f.e)); ctx.stroke(); ctx.restore();
      if (head.matches(':focus-visible')) focusRing(ctx, 8, y + 5, 192, 54);
      y += 63 + body;
    }
    rule(y);
    return moving;
  }
  // #endregion note-accordion
}
customElements.define('note-accordion', NoteAccordion);

// ---------------------------------------------------------------------------------------------------------
// Coast path: an accordion with one leg always open. The map of the open leg unfolds.
// ---------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------
// Order summary: one <details>. The pictures of the things ordered move from a row to a column.
// ---------------------------------------------------------------------------------------------------------

// A picture of one thing on a red ground, in a square of 100 units.
function drawThing(g, kind, seed = 1) {
  const ground = g.createLinearGradient(0, 0, 100, 100); ground.addColorStop(0, '#ee3a22'); ground.addColorStop(1, '#e02d18');
  g.fillStyle = ground; g.fillRect(0, 0, 100, 100);
  const shadow = (x, y, rx, ry) => { g.save(); g.filter = 'blur(1.6px)'; g.fillStyle = 'rgba(120,10,0,0.55)'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); g.restore(); };
  if (kind === 'vase') {
    shadow(64, 91, 30, 4.5);
    const body = () => { g.beginPath(); g.moveTo(40, 6); g.lineTo(60, 6); g.quadraticCurveTo(58, 12, 57, 22); g.bezierCurveTo(88, 34, 96, 80, 66, 93); g.lineTo(36, 93); g.bezierCurveTo(4, 80, 12, 34, 43, 22); g.quadraticCurveTo(42, 12, 40, 6); g.closePath(); };
    const clay = g.createLinearGradient(14, 0, 90, 0); clay.addColorStop(0, '#f1ebe1'); clay.addColorStop(0.55, '#e6ded1'); clay.addColorStop(1, '#b3a797');
    g.fillStyle = clay; body(); g.fill();
    g.save(); body(); g.clip();
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(95,80,62,${0.25 + rnd(seed + i) * 0.4})`; g.fillRect(12 + rnd(i * 3 + 1) * 76, 8 + rnd(i * 5 + 2) * 84, 0.8, 0.8); }
    g.strokeStyle = 'rgba(120,105,88,0.16)'; g.lineWidth = 0.5;
    for (let y = 28; y < 92; y += 4) { g.beginPath(); g.moveTo(8, y); g.quadraticCurveTo(50, y + 2.5, 94, y); g.stroke(); }
    g.restore();
    g.fillStyle = '#cfc6b8'; g.beginPath(); g.ellipse(50, 6, 10, 2.2, 0, 0, TAU); g.fill();
    g.fillStyle = '#6f6557'; g.beginPath(); g.ellipse(50, 6.2, 7.6, 1.3, 0, 0, TAU); g.fill();
  } else if (kind === 'lamp') {
    shadow(60, 92, 26, 3.6);
    const brass = (x0, x1) => { const m = g.createLinearGradient(x0, 0, x1, 0); for (const [at, c] of [[0, '#8a5d12'], [0.25, '#f5d98a'], [0.5, '#c8962f'], [0.8, '#8f6214'], [1, '#d8ad4e']]) m.addColorStop(at, c); return m; };
    g.fillStyle = brass(47, 53); g.fillRect(48.2, 34, 3.6, 54);
    g.fillStyle = brass(28, 72); g.beginPath(); g.ellipse(50, 90, 21, 4, 0, 0, TAU); g.fill();
    g.fillStyle = '#7a520f'; g.beginPath(); g.ellipse(50, 91.6, 21, 3.2, 0, 0, Math.PI); g.fill();
    g.fillStyle = brass(24, 76); g.beginPath(); g.moveTo(22, 40); g.bezierCurveTo(22, 4, 78, 4, 78, 40); g.closePath(); g.fill();
    g.fillStyle = '#6e4a0c'; g.beginPath(); g.ellipse(50, 40, 28, 3.4, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,246,214,0.75)'; g.beginPath(); g.ellipse(38, 20, 3, 8, 0.5, 0, TAU); g.fill();
  } else if (kind === 'book') {
    shadow(66, 92, 30, 3.4);
    g.fillStyle = '#e9e4d8'; g.beginPath(); g.moveTo(20, 88); g.lineTo(76, 88); g.lineTo(80, 92); g.lineTo(24, 92); g.closePath(); g.fill();
    const cloth = g.createLinearGradient(18, 0, 80, 0); cloth.addColorStop(0, '#16307e'); cloth.addColorStop(0.08, '#0f246a'); cloth.addColorStop(0.12, '#1b3a93'); cloth.addColorStop(1, '#122a78');
    g.fillStyle = cloth; g.beginPath(); g.moveTo(18, 12); g.lineTo(74, 9); g.lineTo(76, 88); g.lineTo(20, 88); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 12; y < 88; y += 1.6) g.fillRect(19, y, 56, 0.5);
    g.fillStyle = '#efeadf'; g.beginPath(); g.moveTo(64, 9.6); g.lineTo(67.4, 9.4); g.lineTo(69.2, 88); g.lineTo(65.8, 88); g.closePath(); g.fill();
    g.fillStyle = '#e9e4d8'; g.fillRect(30, 88, 1.4, 6);
  } else {
    shadow(60, 90, 30, 4);
    g.fillStyle = '#d9b98a'; g.fillRect(24, 30, 52, 58); g.fillStyle = '#c4a172'; g.fillRect(24, 30, 52, 12); g.fillStyle = '#efe2c8'; g.fillRect(46, 30, 8, 58);
  }
}

export class OrderSummary extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    details { width: 338px; font: 400 12px/1.25 ${SANS}; color: #6b5f5c; }
    summary { display: flex; justify-content: space-between; align-items: flex-start; height: 55px; padding: 10px 13px 0; box-sizing: border-box; cursor: pointer; touch-action: manipulation; outline: none; }
    summary::-webkit-details-marker { display: none; }
    summary b { display: inline-block; font: 700 16.5px/20px ${SANS}; letter-spacing: -0.03em; color: #1b1413; }
    summary small { display: block; font-size: 11.5px; }
    details[open] .show, details:not([open]) .hide { display: none; }
    .sum { font: 300 19.5px/26px ${SANS}; letter-spacing: -0.02em; color: #1b1413; margin-top: 4px; }
    ul { list-style: none; margin: 0; padding: 0 13px; }
    li { position: relative; height: 73px; padding: 13px 0 0 84px; box-sizing: border-box; }
    li b { display: block; font: 700 15.5px/19px ${SANS}; letter-spacing: -0.03em; color: #1b1413; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
    li small { display: block; font-size: 11px; line-height: 16px; white-space: nowrap; }
    li data { position: absolute; right: 0; top: 13px; font: 400 15px/19px ${SANS}; color: #1b1413; }
    footer { display: flex; justify-content: space-between; align-items: flex-end; margin: 3px 13px 0; padding-top: 9px; border-top: 0.7px solid #dccfd3; height: 56px; box-sizing: border-box; }
    dl { display: grid; grid-template-columns: auto auto; gap: 1px 14px; margin: 0; font-size: 11.5px; line-height: 16px; }
    dd { margin: 0; text-align: right; }
    .total { margin: 0; text-align: right; font: 700 10.5px/1 ${SANS}; color: #1b1413; }
    .total data { font: 700 25px/26px ${SANS}; letter-spacing: -0.04em; margin-left: 5px; }
    .total small { display: block; font: 400 11px/16px ${SANS}; color: #6b5f5c; }`;
  static CLOSED = { y: 96.5, h: 167 }; static OPEN = { y: 11, h: 338 };

  ready() {
    this.details = document.createElement('details'); this.details.setAttribute('drawable', '');
    this.details.open = this.hasAttribute('open');
    (this.canvas ?? this.$('.plain')).append(this.details);
    this.build();
    this.fold = new Fold(this, this.details, 0.5); wire(this, [this.fold]);
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-price', 'data-note', 'data-qty', 'data-art', 'shipping', 'vat', 'currency'] });
    this.sync();
  }
  // #region order-summary
  build() {
    const sign = this.getAttribute('currency') ?? '€', ship = Number(this.getAttribute('shipping') ?? 0), vat = Number(this.getAttribute('vat') ?? 0);
    const items = this.items = options(this).map((o) => ({ name: o.label, note: o.data.note ?? '', qty: Number(o.data.qty ?? 1), price: Number(o.data.price ?? 0), art: o.data.art ?? '' }));
    const sub = items.reduce((s, it) => s + it.price * it.qty, 0), total = this.total = sub + ship, count = items.reduce((s, it) => s + it.qty, 0);
    this.details.innerHTML = `
      <summary><span><b class="show">Show order summary</b><b class="hide">Hide order summary</b><small>${count} item${count === 1 ? '' : 's'}</small></span><data class="sum" value="${total.toFixed(2)}">${money(total, sign)}</data></summary>
      <ul>${items.map((it) => `<li><b>${esc(it.name)}</b><data value="${(it.price * it.qty).toFixed(2)}">${money(it.price * it.qty, sign)}</data><small>${esc(it.note)}</small><small>Qty ${it.qty}</small></li>`).join('')}</ul>
      <footer><dl><dt>Subtotal</dt><dd>${money(sub, sign)}</dd><dt>Shipping</dt><dd>${money(ship, sign)}</dd></dl>
        <p class="total">Total <data value="${total.toFixed(2)}">${money(total, sign)}</data>${vat ? `<small>Including ${money(total * vat / (100 + vat), sign)} VAT</small>` : ''}</p></footer>`;
    this.pictures?.clear();
    if (this.fold) wire(this, [this.fold]);              // the summary is a new element
    this.request();
  }
  get open() { return this.fold.open; }
  set open(v) { this.fold.set(Boolean(v)); this.sync(); }
  sync() { this.setValue(this.fold?.open ? 'open' : 'closed'); }
  pick() { this.fold.set(!this.fold.open); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }

  draw(ctx, w, h) {
    const { CLOSED, OPEN } = OrderSummary, f = this.fold, moving = f.step(this.dt), e = f.e;
    const top = lerp(CLOSED.y, OPEN.y, e), tall = lerp(CLOSED.h, OPEN.h, e), head = this.details.firstElementChild;
    ctx.fillStyle = '#e8331f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(11, top, 338, tall);
    ctx.save(); ctx.beginPath(); ctx.rect(11, top, 338, tall); ctx.clip();
    put(ctx, this.details, 11, top);
    // The rows of text arrive after the pictures have left the row: white is drawn over them until then.
    const veil = 1 - smooth((f.t - 0.4) / 0.6);
    if (f.t > 0 && veil > 0) { ctx.fillStyle = `rgba(255,255,255,${veil})`; ctx.fillRect(11, top + 55, 338, tall - 55); }
    // the chevron after the words turns over
    const label = head.querySelector(f.d.open && f.t > 0.5 ? '.hide' : '.show') ?? head.querySelector('b'), cx = 11 + 13 + (label.offsetWidth || 150) + 15;
    ctx.translate(cx, top + 21); ctx.rotate(e * Math.PI); ctx.strokeStyle = '#e8331f'; ctx.lineWidth = 2; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(-5.5, -2.8); ctx.lineTo(0, 2.8); ctx.lineTo(5.5, -2.8); ctx.stroke();
    ctx.restore();
    // #region order-pictures
    // Each picture goes from its place in the row to its place in the column, one after another.
    this.items.forEach((it, i) => {
      const k = reduced() ? e : smooth(clamp(f.t * 1.35 - i * 0.12)), n = Math.max(3, this.items.length);
      const row = { x: 24 + i * (312 - 99) / (n - 1), y: top + 55, s: 99 }, col = { x: 24, y: top + 55 + 3 + i * 73, s: 70 };
      const x = lerp(row.x, col.x, k), y = lerp(row.y, col.y, k), s = lerp(row.s, col.s, k);
      ctx.drawImage(cached(this, `thing${i}`, 100, 100, (g) => drawThing(g, it.art, i + 1)), x, y, s, s);
    });
    // #endregion order-pictures
    if (head.matches(':focus-visible')) focusRing(ctx, 15, top + 4, 330, 47, '#1b1413');
    return moving;
  }
  // #endregion order-summary
}
customElements.define('order-summary', OrderSummary);

// ---------------------------------------------------------------------------------------------------------
// Bus stop timetable: radios for tabs, and a <dl> of departures for each that slides across.
// ---------------------------------------------------------------------------------------------------------

export class BusTabs extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HEAD = 104; static TABS = 41;
  static css = `
    input { opacity: 0; margin: 0; touch-action: manipulation; }
    label { text-align: center; font: 700 19px/41px ${COND}; font-stretch: condensed; letter-spacing: -0.01em; color: #fff; white-space: nowrap; cursor: pointer; }
    .head { width: 360px; height: 104px; color: #fff; font: 600 11px/1.2 ${SANS}; }
    .route { font: 700 104px/104px ${COND}; font-stretch: condensed; letter-spacing: -0.045em; color: #fff; white-space: nowrap; }
    .head span { position: absolute; left: 118px; }
    .head .from { top: 12px; } .head .to { top: 79px; }
    .head .stop { top: 33px; font: 700 27px/1.2 ${COND}; font-stretch: condensed; letter-spacing: -0.01em; }
    dl { width: 360px; height: 215px; margin: 0; padding: 9px 14px 0; box-sizing: border-box; columns: 2; column-gap: 10px; font: 700 11.5px/20px ${COND}; font-stretch: condensed; color: #151515; }
    dl div { display: flex; height: 20px; margin-bottom: 0.6px; break-inside: avoid; }
    dl div:nth-child(odd) { background: linear-gradient(#d3ecd9, #d3ecd9) 0 0 / 100% 14px no-repeat; }
    dt { flex: none; width: 27px; text-align: center; font-size: 13px; color: #fff; background: #0a9c47; }
    dd { flex: 1; display: flex; justify-content: space-around; margin: 0; padding: 0 3px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-times', 'route', 'stop', 'towards', 'label'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }
  // #region bus-tabs
  build() {
    const days = this.days = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Day of the week';
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); box.append(el); return el; };
    this.head = add(`<div class="head"><span class="from">Departures from</span><span class="stop">${esc(this.getAttribute('stop') ?? '')}</span><span class="to">towards ${esc(this.getAttribute('towards') ?? '')}</span></div>`);
    this.route = add(`<b class="route">${esc(this.getAttribute('route') ?? '')}</b>`);
    const tw = 360 / Math.max(1, days.length);
    this.radios = []; this.labels = []; this.panels = [];
    days.forEach((o, i) => {
      const r = add(`<input type="radio" name="day" id="d${i}" value="${esc(o.value)}">`); r.style.cssText = `width:${tw}px;height:41px`;
      const l = add(`<label for="d${i}">${esc(o.label)}</label>`); l.style.width = `${tw}px`;
      // "0510 0525 0610" becomes one row for each hour, in the order the hours first appear
      const hours = new Map();
      for (const t of (o.data.times ?? '').split(/[\s,]+/).filter(Boolean)) { const hh = t.slice(0, 2); hours.set(hh, [...(hours.get(hh) ?? []), t.slice(-2)]); }
      const p = add(`<dl aria-label="${esc(o.label)} departures">${[...hours].map(([hh, mins]) => `<div><dt>${esc(hh)}</dt><dd>${mins.map((m) => `<span>${esc(m)}</span>`).join('')}</dd></div>`).join('')}</dl>`);
      this.radios.push(r); this.labels.push(l); this.panels.push(p);
    });
    const at = Math.max(0, days.findIndex((o) => o.value === was), was ? -1 : days.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.pos = { x: at, v: 0 };
    this.sync();
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.sync(); this.request(); }
  sync() {
    // Every timetable stays laid out so that two can be drawn during a slide. Only the checked day's is read out.
    this.panels.forEach((p, i) => { p.inert = i !== this.index; });
    this.setValue(this.value);
  }

  draw(ctx, w, h) {
    const { HEAD, TABS } = BusTabs, n = this.radios.length, tw = w / Math.max(1, n);
    const moving = spring(this.pos, this.index, this.dt, 210, 27), x = this.pos.x;
    const green = ctx.createLinearGradient(0, 0, w, HEAD); green.addColorStop(0, '#22ad5a'); green.addColorStop(0.45, '#0ea24c'); green.addColorStop(1, '#08964a');
    ctx.fillStyle = green; ctx.fillRect(0, 0, w, HEAD);
    put(ctx, this.head, 0, 0);
    put(ctx, this.route, 10, 2, Math.min(this.route.offsetWidth, 98), 104);     // squeezed to fit if the face is wide
    // the strip of tabs: white names on black, and a paper tab that slides to the checked one
    ctx.fillStyle = '#111'; ctx.fillRect(0, HEAD, w, TABS);
    this.labels.forEach((l, i) => put(ctx, l, i * tw, HEAD));
    ctx.save(); ctx.beginPath(); ctx.rect(x * tw, HEAD, tw, TABS); ctx.clip();
    ctx.fillStyle = '#f3f5f0'; ctx.fillRect(0, HEAD, w, TABS);
    ctx.filter = 'invert(1)'; this.labels.forEach((l, i) => put(ctx, l, i * tw, HEAD));
    ctx.restore();
    // the timetables side by side, moved so that the checked one is in view
    ctx.fillStyle = '#f3f5f0'; ctx.fillRect(0, HEAD + TABS, w, h - HEAD - TABS);
    ctx.save(); ctx.beginPath(); ctx.rect(0, HEAD + TABS, w, h - HEAD - TABS); ctx.clip();
    this.panels.forEach((p, i) => {
      const px = (i - x) * w;
      if (px <= -w + 0.5 || px >= w - 0.5) return;
      put(ctx, p, px, HEAD + TABS);
      if (px > 0.5) { ctx.fillStyle = '#111'; ctx.fillRect(px - 0.8, HEAD + TABS, 1.2, h); }
    });
    ctx.restore();
    this.radios.forEach((r, i) => {
      if (r.matches(':focus-visible')) focusRing(ctx, i * tw + 4, HEAD + 4, tw - 8, TABS - 8, r.checked ? '#111' : '#fff');
      hit(ctx, r, i * tw, HEAD, tw, TABS);
    });
    return moving;
  }
  // #endregion bus-tabs
}
customElements.define('bus-tabs', BusTabs);

// ---------------------------------------------------------------------------------------------------------
// Kinetic poster: radios for a period, and an <output> whose picture is stretched to fill the poster.
// ---------------------------------------------------------------------------------------------------------

const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : Math.round(n).toLocaleString('en-US'));

export class PosterTabs extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOX = { x: 20, y: 86, w: 320, h: 194 };      // the figure fills this
  static TAB = { x: 20, y: 20, w: 320, h: 48 };
  static css = `
    input { opacity: 0; margin: 0; touch-action: manipulation; }
    label { font: 300 36px/48px ${SANS}; color: #fff; white-space: nowrap; cursor: pointer; }
    input:checked + label { font-weight: 900; color: #1f2ee6; }
    output { font: 900 240px/1 Impact, Haettenschweiler, 'Arial Narrow', ${COND}; font-stretch: condensed; color: #fff; white-space: nowrap; }
    .unit, .delta { margin: 0; font: 300 34px/40px ${SANS}; color: #fff; white-space: nowrap; }
    .delta { color: #d6ff3c; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-count', 'data-change', 'unit', 'label'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.show(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }
  // #region poster-tabs
  build() {
    const items = this.items = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Period';
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); box.append(el); return el; };
    this.radios = []; this.labels = [];
    items.forEach((o, i) => { this.radios.push(add(`<input type="radio" name="period" id="p${i}" value="${esc(o.value)}">`)); this.labels.push(add(`<label for="p${i}">${esc(o.label)}</label>`)); });
    // Two outputs: the one that shows the figure now, and the one that showed the figure before it.
    this.outs = [add(`<output for="${items.map((_, i) => `p${i}`).join(' ')}"></output>`), add('<output inert></output>')];
    this.unit = add(`<p class="unit">${esc(this.getAttribute('unit') ?? '')}</p>`);
    this.delta = add('<p class="delta"><data></data></p>');
    // A tab is as wide as its name needs, as a share of the strip. The names are drawn at 0.62 of their width.
    const need = this.labels.map((l) => l.offsetWidth * 0.62 + 26), all = need.reduce((s, v) => s + v, 0) || 1;
    let x = PosterTabs.TAB.x;
    this.slots = need.map((v) => { const s = { x, w: (v / all) * PosterTabs.TAB.w }; x += s.w; return s; });
    const at = Math.max(0, items.findIndex((o) => o.value === was), was ? -1 : items.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.mark = { x: { x: this.slots[at]?.x ?? 0, v: 0 }, w: { x: this.slots[at]?.w ?? 0, v: 0 } };
    this.now = 0; this.turn = 1;                        // which output is current, and how far the change has got
    this.show(true);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.show(); }
  show(first = false) {
    const o = this.items[this.index]; if (!o) return;
    const text = count(Number(o.data.count ?? 0)), change = Number(o.data.change ?? 0);
    if (!first && this.outs[this.now].value === text) return;
    if (!first) { this.now = 1 - this.now; this.turn = reduced() ? 1 : 0; }
    const cur = this.outs[this.now], old = this.outs[1 - this.now];
    cur.value = text; cur.inert = false; old.inert = true;
    const d = this.delta.firstElementChild; d.value = String(change); d.textContent = `${change > 0 ? '+' : ''}${change}%`;
    this.setValue(this.value); this.request();
  }
  // #endregion poster-tabs

  // #region poster-fill
  // Where the ink of an output's text is inside the element: from the left edge of the first glyph to the
  // right edge of the last, and from the top of a figure to the baseline. A comma hangs below that.
  ink(out) {
    const key = `${out.value}|${out.offsetWidth}`;
    if (out.inkKey === key) return out.inkBox;
    measure.font = getComputedStyle(out).font;
    const m = measure.measureText(out.value), cap = measure.measureText('0').actualBoundingBoxAscent, size = out.offsetHeight;
    const baseline = (size - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    out.inkKey = key;
    return out.inkBox = { x: -m.actualBoundingBoxLeft, y: baseline - cap, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h: cap };
  }
  // Draw the output so that its ink fills the rectangle x, y, w, h. The picture is stretched both ways.
  fill(ctx, out, x, y, w, h) {
    if (h < 0.5 || !out.value) return;
    const k = this.ink(out), sx = w / k.w, sy = h / k.h;
    put(ctx, out, x - k.x * sx, y - k.y * sy, out.offsetWidth * sx, out.offsetHeight * sy);
  }
  // #endregion poster-fill

  draw(ctx, w, h) {
    const { BOX, TAB } = PosterTabs, slot = this.slots[this.index] ?? { x: 0, w: 0 };
    let moving = spring(this.mark.x, slot.x, this.dt, 230, 24);
    moving = spring(this.mark.w, slot.w, this.dt, 230, 24) || moving;
    if (this.turn < 1) { this.turn = Math.min(1, this.turn + this.dt / 0.42); moving = true; }
    const p = easeOut(this.turn);

    ctx.fillStyle = '#1f2ee6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d6ff3c'; ctx.fillRect(this.mark.x.x, TAB.y, this.mark.w.x, TAB.h);
    this.labels.forEach((l, i) => { const s = this.slots[i], lw = l.offsetWidth * 0.62; put(ctx, l, s.x + (s.w - lw) / 2, TAB.y, lw, TAB.h); });
    ctx.fillStyle = '#fff'; ctx.fillRect(TAB.x, TAB.y + TAB.h, TAB.w, 3);

    // The old figure is pressed flat against the top of the box while the new one grows up from the bottom.
    const cur = this.outs[this.now], old = this.outs[1 - this.now], split = BOX.h * (1 - p);
    if (p < 1) { ctx.save(); ctx.globalAlpha = 1 - p * 0.3; this.fill(ctx, old, BOX.x, BOX.y, BOX.w, split - 3); ctx.restore(); }
    this.fill(ctx, cur, BOX.x, BOX.y + split, BOX.w, BOX.h - split);
    // The outputs are wider than the canvas. Their hit regions are taken back off the tabs by drawing those last.
    const uw = this.unit.offsetWidth * 0.62, dw = this.delta.offsetWidth * 0.62;
    put(ctx, this.unit, 20, 308, uw, 40);
    put(ctx, this.delta, 340 - dw, 308, dw, 40);
    this.radios.forEach((r, i) => {
      const s = this.slots[i];
      if (r.matches(':focus-visible')) focusRing(ctx, s.x + 3, TAB.y + 3, s.w - 6, TAB.h - 6, r.checked ? '#1f2ee6' : '#fff');
      hit(ctx, r, s.x, TAB.y, s.w, TAB.h);
    });
    return moving;
  }
}
customElements.define('poster-tabs', PosterTabs);

// Shared with trees.js and timelines.js.
export { Fold, cached, focusRing };
