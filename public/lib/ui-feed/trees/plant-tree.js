// <plant-tree>: nested <details> tree of a plant family drawn over a cyanotype print.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, TAU } from '../kit.js';
import { Fold, cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Cormorant Garamond', 'EB Garamond', Garamond, 'Hoefler Text', 'Baskerville', 'Noto Serif', 'Times New Roman', serif";

// #region tree-read
// The author's nested list as plain data. The label is the text of the <li> itself, a <small> is a note,
// data-* attributes are kept, and data-open says that a branch starts open.
function readTree(host) {
  const walk = (ul, path) => [...ul.children].filter((li) => li.localName === 'li').map((li) => {
    const sub = li.querySelector(':scope > ul');
    const label = [...li.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const here = path ? `${path}/${label}` : label;
    return { label, path: here, note: li.querySelector(':scope > small')?.textContent.trim() ?? '', data: { ...li.dataset }, open: 'open' in li.dataset, children: sub ? walk(sub, here) : null };
  });
  const ul = host.querySelector(':scope > ul');
  return ul ? walk(ul, '') : [];
}
// #endregion tree-read

// #region tree-base
// One drawable <div> holds the whole tree, so the browser lays it out and one picture has every row.
//
// While a branch opens or closes, its rows are laid out at full height but must be drawn part way. The
// control works out where each row should be seen, then draws the same picture once for each row, moved
// so that the row lands in its place and clipped to the part of the row that shows. When nothing is
// moving, every row is where the browser laid it out and one draw does.
class TreeControl extends FeedControl {
  static ORIGIN = [0, 0];
  static seconds = 0.3;

  ready() {
    this.root = document.createElement('div');
    this.root.className = 'tree'; this.root.setAttribute('drawable', '');
    (this.canvas ?? this.$('.plain')).append(this.root);
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, characterData: true });
    this.root.addEventListener('click', (e) => {
      const head = e.target.closest('summary');
      if (!head || this.plain) return;
      e.preventDefault(); this.pick(this.folds.get(head.parentElement), head);
    });
  }
  build() {
    this.nodes = readTree(this);
    this.root.innerHTML = this.render(this.nodes, 0);
    this.folds = new Map([...this.root.querySelectorAll('details')].map((d) => [d, new Fold(this, d, this.constructor.seconds)]));
    this.marked = null; this.pictures?.clear();
    this.sync(); this.request();
  }
  mark(el) { this.marked?.classList.remove('on'); this.marked = el; el?.classList.add('on'); }
  pick(fold, head) {
    fold.set(!fold.open); this.mark(head); this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {}
  // Each row with where it is laid out (ly) and where it is drawn (y), both from the top of the tree, and
  // the band it may be seen in (top to bottom), which a closing ancestor makes shorter.
  // The height a branch's rows take as drawn: a branch that is part open counts for part of its rows.
  tall(box, depth = 1) {
    let h = 0;
    for (const el of box.children) { const d = el.localName === 'details' ? el : null; h += this.rowHeight(d ? d.firstElementChild : el, depth); if (d?.open) h += this.tall(d.lastElementChild, depth + 1) * this.folds.get(d).e; }
    return h;
  }
  rowHeight(row) { return row.offsetHeight; }           // a control may draw a row shorter than it is laid out
  rows() {
    const out = [];
    const walk = (box, y, top, bottom, alpha, depth) => {
      for (const el of box.children) {
        const d = el.localName === 'details' ? el : null, row = d ? d.firstElementChild : el, s = this.slice(row, this.root), fold = d ? this.folds.get(d) : null, h = this.rowHeight(row, depth);
        out.push({ el: row, d, fold, y, ly: s.top, h, top, bottom, alpha, depth });
        y += h;
        if (d?.open) { const shown = this.tall(d.lastElementChild, depth + 1) * fold.e; walk(d.lastElementChild, y, top, Math.min(bottom, y + shown), alpha * Math.min(1, fold.e * 1.4), depth + 1); y += shown; }
      }
      return y;
    };
    this.height = walk(this.root, 0, 0, Infinity, 1, 0);
    return out;
  }
  // Step every fold, then return the rows. `this.moving` says whether another frame is needed.
  step() {
    this.moving = false;
    for (const f of this.folds.values()) this.moving = f.step(this.dt) || this.moving;
    return this.rows();
  }
  // Draw the tree. At rest: one draw. While a branch moves: one clipped draw for each row.
  paint(ctx, rows) {
    const [ox, oy] = this.constructor.ORIGIN, w = this.root.offsetWidth;
    if (!this.moving && !this.uneven) return put(ctx, this.root, ox, oy);
    for (const r of rows) {
      const a = Math.max(r.y, r.top), b = Math.min(r.y + r.h, r.bottom);
      if (b - a < 0.2 || r.alpha < 0.02) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy + a, w, b - a); ctx.clip();
      ctx.globalAlpha = r.alpha; put(ctx, this.root, ox, oy + r.y - r.ly);
      ctx.restore();
    }
    hit(ctx, this.root, ox, oy);                        // the hit region goes back to where the rows are laid out
  }
  // The band of a row that shows, in the control's units, or null if none of it does.
  band(r) { const [, oy] = this.constructor.ORIGIN, a = Math.max(r.y, r.top), b = Math.min(r.y + r.h, r.bottom); return b - a > 0.2 ? { y: oy + r.y, a: oy + a, b: oy + b } : null; }
}
// #endregion tree-base

// A triangle that turns from pointing right to pointing down as a branch opens.
function marker(ctx, x, y, size, e, colour) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(e * Math.PI / 2); ctx.fillStyle = colour;
  ctx.beginPath(); ctx.moveTo(-size * 0.45, -size * 0.6); ctx.lineTo(size * 0.6, 0); ctx.lineTo(-size * 0.45, size * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawCyanotype(g, W, H) {
  // paper, then Prussian blue brushed on with a ragged edge
  g.fillStyle = '#f1ede4'; g.fillRect(0, 0, W, H);
  g.save();
  g.beginPath();
  const edge = (i) => 3 + rnd(i) * 3.2;
  g.moveTo(edge(1), edge(2));
  for (let x = 0; x <= W; x += 6) g.lineTo(x, 2.5 + rnd(x) * 3.5);
  for (let y = 0; y <= H; y += 6) g.lineTo(W - 2.5 - rnd(y + 500) * 4, y);
  for (let x = W; x >= 0; x -= 6) g.lineTo(x, H - 3 - rnd(x + 900) * 4.5);
  for (let y = H; y >= 0; y -= 6) g.lineTo(2.5 + rnd(y + 1300) * 4, y);
  g.closePath(); g.clip();
  const blue = g.createLinearGradient(0, 0, W, H); blue.addColorStop(0, '#17367f'); blue.addColorStop(0.5, '#1c3f93'); blue.addColorStop(1, '#152f72');
  g.fillStyle = blue; g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 150; i++) {                       // the strokes of the brush
    const y = rnd(i) * H, x = rnd(i + 200) * W - 60, len = 60 + rnd(i + 400) * 220;
    g.strokeStyle = rnd(i + 600) > 0.5 ? `rgba(40,84,170,${0.05 + rnd(i + 700) * 0.1})` : `rgba(8,20,70,${0.05 + rnd(i + 800) * 0.12})`;
    g.lineWidth = 2 + rnd(i + 900) * 9;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y + (rnd(i + 1000) - 0.5) * 6, x + len, y + (rnd(i + 1100) - 0.5) * 4); g.stroke();
  }
  // the branch that lay on the paper: where it kept the light off, the paper stayed pale
  const stem = (t) => [292 - 44 * t + 22 * Math.sin(t * 2.6 + 0.4), 8 + 338 * t];
  g.strokeStyle = 'rgba(226,236,250,0.92)'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.beginPath();
  for (let t = 0; t <= 1.001; t += 0.02) g.lineTo(...stem(t));
  g.stroke();
  const leaf = (x, y, angle, len, wide, seed) => {
    g.save(); g.translate(x, y); g.rotate(angle);
    g.strokeStyle = 'rgba(226,236,250,0.9)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(0, 0); g.lineTo(9, 0); g.stroke();
    g.translate(9, 0);
    const body = g.createLinearGradient(0, -wide, len, wide); body.addColorStop(0, 'rgba(244,248,253,0.96)'); body.addColorStop(0.6, 'rgba(224,234,249,0.93)'); body.addColorStop(1, 'rgba(190,208,238,0.85)');
    g.fillStyle = body; g.beginPath(); g.moveTo(0, 0);
    const n = 14;                                        // a toothed edge
    for (let i = 1; i <= n; i++) { const t = i / n, hw = wide * Math.sin(Math.PI * t ** 0.8) * (1 - 0.25 * t); g.lineTo(len * (t - 0.02), -hw * 0.94); g.lineTo(len * t, -hw); }
    for (let i = n; i >= 0; i--) { const t = i / n, hw = wide * Math.sin(Math.PI * t ** 0.8) * (1 - 0.25 * t); g.lineTo(len * t, hw); g.lineTo(len * (t - 0.02), hw * 0.94); }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(70,104,180,0.4)'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.96, 0);
    for (let i = 1; i < 7; i++) { const t = i / 7.5, hw = wide * Math.sin(Math.PI * t ** 0.8) * 0.8; g.moveTo(len * t, 0); g.lineTo(len * (t + 0.13), -hw); g.moveTo(len * t, 0); g.lineTo(len * (t + 0.13), hw); }
    g.stroke();
    g.fillStyle = `rgba(28,63,147,${0.05 + rnd(seed) * 0.1})`; g.beginPath(); g.ellipse(len * 0.6, wide * 0.3, len * 0.3, wide * 0.4, 0, 0, TAU); g.fill();
    g.restore();
  };
  const flower = (x, y, r, turn, seed) => {
    g.save(); g.translate(x, y); g.rotate(turn);
    for (let i = 0; i < 5; i++) {
      g.save(); g.rotate((i / 5) * TAU);
      const petal = g.createRadialGradient(0, -r * 0.2, 1, 0, -r * 0.6, r); petal.addColorStop(0, 'rgba(120,150,215,0.9)'); petal.addColorStop(0.5, 'rgba(160,186,236,0.88)'); petal.addColorStop(1, 'rgba(198,216,246,0.82)');
      g.fillStyle = petal; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-r * 0.75, -r * 0.35, -r * 0.6, -r * 1.05, 0, -r); g.bezierCurveTo(r * 0.6, -r * 1.05, r * 0.75, -r * 0.35, 0, 0); g.fill();
      g.restore();
    }
    g.strokeStyle = 'rgba(240,246,255,0.9)'; g.fillStyle = 'rgba(250,252,255,0.95)'; g.lineWidth = 0.45;
    for (let i = 0; i < 14; i++) { const a = rnd(seed + i) * TAU, d = r * (0.3 + rnd(seed + i + 50) * 0.3); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * d, Math.sin(a) * d); g.stroke(); g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.75, 0, TAU); g.fill(); }
    g.restore();
  };
  const twig = (from, to) => { g.strokeStyle = 'rgba(226,236,250,0.85)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(...from); g.quadraticCurveTo((from[0] + to[0]) / 2 + 4, (from[1] + to[1]) / 2 - 5, ...to); g.stroke(); };
  [[0.06, -2.5, 46, 17], [0.16, 0.5, 36, 14], [0.3, 0.75, 44, 16], [0.4, 2.45, 46, 16], [0.5, 0.6, 46, 17], [0.62, 2.5, 44, 15], [0.76, 0.5, 40, 15], [0.9, 1.9, 44, 14]].forEach(([t, a, len, wide], i) => leaf(...stem(t), a, len, wide, i));
  for (const [t, spots] of [[0.2, [[-52, 14, 15], [-74, 32, 14], [-38, 34, 9]]], [0.68, [[-44, 34, 14], [-22, 54, 14], [-64, 46, 8]]]]) {
    const at = stem(t);
    spots.forEach(([dx, dy, r], i) => { twig(at, [at[0] + dx, at[1] + dy]); if (r < 10) { g.fillStyle = 'rgba(214,228,248,0.9)'; g.beginPath(); g.ellipse(at[0] + dx, at[1] + dy, 3.4, 4.6, 0.4, 0, TAU); g.fill(); } else flower(at[0] + dx, at[1] + dy, r, i * 0.7 + t * 5, i * 31 + t * 100); });
  }
  g.restore();
}

export class PlantTree extends TreeControl {
  static size = [360, 360];
  static radius = 3;
  static ORIGIN = [20, 24];
  static css = `
    .tree { width: 172px; color: #f6f3ea; font: 400 16px/25px ${SERIF}; }
    summary { display: block; height: 29px; overflow: hidden; padding-left: 26px; cursor: pointer; touch-action: manipulation; outline: none; font: italic 500 20px/29px ${SERIF}; }
    summary::-webkit-details-marker { display: none; }
    .tree > details > summary { height: 35px; padding-left: 18px; font: 500 25px/35px ${SERIF}; font-style: normal; }
    .leaf { height: 25px; overflow: hidden; }
    .kids .kids > .leaf { display: flex; justify-content: space-between; align-items: baseline; padding-left: 26px; white-space: nowrap; }
    .leaf small { font: italic 400 11px/25px ${SERIF}; }
    .on { color: #1a3a8a; }`;

  // #region plant-tree
  render(nodes) {
    return nodes.map((n) => (n.children
      ? `<details${n.open ? ' open' : ''}><summary>${esc(n.label)}</summary><div class="kids">${this.render(n.children)}</div></details>`
      : `<div class="leaf">${esc(n.label)}<small>${esc(n.note)}</small></div>`)).join('');
  }
  sync() { this.setValue([...this.folds].filter(([, f]) => f.open).map(([d]) => d.firstElementChild.textContent).join(',') || null); }

  draw(ctx, w, h) {
    const rows = this.step(), [ox] = PlantTree.ORIGIN;
    ctx.drawImage(cached(this, 'print', w, h, drawCyanotype), 0, 0, w, h);
    for (const r of rows) {
      const b = this.band(r); if (!b || !r.d) continue;
      if (r.el === this.marked) {                       // a bar of bare paper under the branch that was last used
        ctx.save(); ctx.beginPath(); ctx.rect(0, b.a, w, b.b - b.a); ctx.clip();
        ctx.fillStyle = '#f4f1e8'; ctx.beginPath(); ctx.moveTo(ox + 2, b.y + 3);
        for (let x = 0; x <= 164; x += 8) ctx.lineTo(ox + 2 + x, b.y + 2.4 + rnd(x) * 1.6);
        for (let x = 164; x >= 0; x -= 8) ctx.lineTo(ox + 2 + x + rnd(x + 40) * 2, b.y + r.h - 2.6 - rnd(x + 80) * 1.6);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    this.paint(ctx, rows);
    for (const r of rows) {
      const b = this.band(r); if (!b || !r.d) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(0, b.a, w, b.b - b.a); ctx.clip(); ctx.globalAlpha = r.alpha;
      marker(ctx, ox + (r.depth ? 15 : 6), b.y + r.h / 2 + 1, r.depth ? 5 : 5.5, r.fold.e, r.el === this.marked ? '#1a3a8a' : '#f6f3ea');
      if (r.el.matches(':focus-visible')) focusRing(ctx, ox + 1, b.y + 2, 168, r.h - 4, r.el === this.marked ? '#1a3a8a' : '#fff');
      ctx.restore();
    }
    return this.moving;
  }
  // #endregion plant-tree
}
customElements.define('plant-tree', PlantTree);
