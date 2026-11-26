// <note-accordion>: fragrance notes accordion of <details>, one open at a time, beside a drawn bottle.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, rr, TAU } from '../kit.js';
import { Fold, wire, cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Didot', 'Bodoni MT', 'Bodoni 72', 'Playfair Display', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";

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
