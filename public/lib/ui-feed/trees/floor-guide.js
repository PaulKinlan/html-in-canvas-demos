// <floor-guide>: store floor guide as nested <details>, one floor open at a time with growing numerals.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, lerp } from '../kit.js';
import { Fold, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SERIF = "'Cormorant Garamond', 'EB Garamond', Garamond, 'Hoefler Text', 'Baskerville', 'Noto Serif', 'Times New Roman', serif";
const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";

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
  tall(box, depth = 1) {
    let h = 0;
    for (const el of box.children) { const d = el.localName === 'details' ? el : null; h += this.rowHeight(d ? d.firstElementChild : el, depth); if (d?.open) h += this.tall(d.lastElementChild, depth + 1) * this.folds.get(d).e; }
    return h;
  }
  rowHeight(row) { return row.offsetHeight; }
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
  step() {
    this.moving = false;
    for (const f of this.folds.values()) this.moving = f.step(this.dt) || this.moving;
    return this.rows();
  }
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
    hit(ctx, this.root, ox, oy);
  }
  band(r) { const [, oy] = this.constructor.ORIGIN, a = Math.max(r.y, r.top), b = Math.min(r.y + r.h, r.bottom); return b - a > 0.2 ? { y: oy + r.y, a: oy + a, b: oy + b } : null; }
}

// A triangle that turns from pointing right to pointing down as a branch opens.
function marker(ctx, x, y, size, e, colour) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(e * Math.PI / 2); ctx.fillStyle = colour;
  ctx.beginPath(); ctx.moveTo(-size * 0.45, -size * 0.6); ctx.lineTo(size * 0.6, 0); ctx.lineTo(-size * 0.45, size * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
}

let felt = null;
export class FloorGuide extends TreeControl {
  static size = [360, 360];
  static radius = 3;
  static ORIGIN = [16, 16];
  static FULL = 54.6;                                 // the height of a heading when no floor is open
  static css = `
    .tree { width: 328px; color: #f4efe2; font: italic 500 14.5px/20px ${DISPLAY}; }
    summary { display: flex; align-items: baseline; cursor: pointer; touch-action: manipulation; outline: none; }
    summary::-webkit-details-marker { display: none; }
    .tree > details > summary { height: var(--row, 54.6px); padding: 5px 0 0 93px; box-sizing: border-box; font: 500 23px/34px ${DISPLAY}; font-style: normal; }
    .tree > details > summary small { margin-left: auto; font: italic 400 10px/34px ${SERIF}; letter-spacing: 0.04em; opacity: 0.85; }
    .n { position: absolute; left: 0; width: 60px; opacity: 0; }
    .tree > details > .kids { padding-left: 107px; }
    .kids .kids { padding-left: 14px; font-size: 12.5px; line-height: 18px; opacity: 0.9; }
    .kids summary { color: #f4efe2; }
    .on { color: #0e3a21; }
    .kids .on { color: #ffb3a7; }`;

  // #region floor-guide
  render(nodes, depth = 0) {
    return nodes.map((n) => (n.children
      ? `<details${n.open ? ' open' : ''} data-value="${esc(n.data.floor ?? n.label)}"><summary>${depth ? '' : `<span class="n">${esc(n.data.floor ?? '')} ${esc(n.data.name ?? '')}: </span>`}${esc(n.label)}${n.note ? `<small>${esc(n.note)}</small>` : ''}</summary><div class="kids">${this.render(n.children, depth + 1)}</div></details>`
      : `<div class="leaf">${esc(n.label)}</div>`)).join('');
  }
  floors() { return [...this.root.children].filter((d) => d.localName === 'details').map((d) => this.folds.get(d)); }
  get value() { return this.floors().find((f) => f.open)?.d.dataset.value ?? ''; }
  sync() { this.setValue(this.value || null); }
  // One floor is open at a time. A department inside a floor opens and closes on its own.
  pick(fold, head) {
    this.root.style.removeProperty('--row');          // back to full headings before anything moves
    if (fold.d.parentElement === this.root) for (const f of this.floors()) if (f !== fold) f.set(false);
    super.pick(fold, head);
  }
  opened(fold) { if (fold.d.parentElement === this.root) for (const f of this.floors()) if (f !== fold) f.set(false); }
  // #region floor-rows
  // The guide keeps its height. The rows of an open floor come out of the height of all six headings, so a
  // heading is drawn shorter than it is laid out while anything moves. When the folds come to rest the same
  // height is given to the layout (--row), and from then on the drawing and the layout agree again.
  rowHeight(row, depth) { return depth === 0 ? this.rowTall : row.offsetHeight; }
  step() {
    const floors = this.floors(), full = FloorGuide.FULL;
    let moving = false, inside = 0;
    for (const f of this.folds.values()) moving = f.step(this.dt) || moving;
    for (const f of floors) if (f.d.open) inside += this.tall(f.d.lastElementChild, 1) * f.e;
    this.rowTall = floors.length ? (full * floors.length - inside) / floors.length : full;
    const laid = floors[0]?.d.firstElementChild.offsetHeight ?? full;
    this.uneven = Math.abs(laid - this.rowTall) > 0.51;      // offsetHeight is a whole number
    if (moving && this.root.style.getPropertyValue('--row')) this.root.style.removeProperty('--row');
    else if (!moving && this.uneven && !this.settling) {
      // The layout changes in the next frame, before its paint, so that the picture and the offsets match.
      this.settling = requestAnimationFrame(() => { this.settling = 0; this.root.style.setProperty('--row', `${this.rowTall}px`); this.request(); });
    }
    this.moving = moving;
    return this.rows();
  }
  // #endregion floor-rows

  draw(ctx, w, h) {
    const rows = this.step(), [ox, oy] = FloorGuide.ORIGIN;
    ctx.fillStyle = '#0e3a21'; ctx.fillRect(0, 0, w, h);
    if (!felt) { felt = document.createElement('canvas'); felt.width = felt.height = 90; const g = felt.getContext('2d'); for (let i = 0; i < 1500; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)'; g.fillRect(rnd(i + 1) * 90, rnd(i + 2) * 90, 1, 1); } }
    ctx.fillStyle = ctx.createPattern(felt, 'repeat'); ctx.fillRect(0, 0, w, h);
    for (const r of rows) {
      const b = this.band(r); if (!b) continue;
      if (r.depth === 0) { ctx.fillStyle = 'rgba(244,239,226,0.45)'; ctx.fillRect(ox, b.y, 328, 0.6); }
      if (r.el === this.marked && r.depth === 0) { ctx.fillStyle = '#ffb3a7'; ctx.fillRect(ox + 71, b.y + 9, 262, 27); }
    }
    ctx.fillStyle = 'rgba(244,239,226,0.45)'; ctx.fillRect(ox, oy + this.height, 328, 0.6);
    this.paint(ctx, rows);
    for (const r of rows) {
      const b = this.band(r); if (!b || !r.d) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(0, b.a, w, b.b - b.a + (r.depth ? 0 : 200)); ctx.clip(); ctx.globalAlpha = r.alpha;
      if (r.depth === 0) {
        // the numeral of a floor is in its summary for a screen reader, and is drawn here so that it can grow
        const e = r.fold.e, size = lerp(r.h * 0.68, 74, e);
        ctx.fillStyle = '#ffb3a7'; ctx.font = `italic 400 ${size}px ${DISPLAY}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.fillText(r.d.dataset.value, ox + lerp(6, 12, e), b.y + lerp(r.h * 0.82, 70, e));
        marker(ctx, ox + 79, b.y + 23, 4.2, e, r.el === this.marked ? '#0e3a21' : '#f4efe2');
      } else marker(ctx, ox + 97 + (r.depth - 1) * 14, b.y + r.h / 2 + 1, 3.2, r.fold.e, r.el === this.marked ? '#ffb3a7' : '#f4efe2');
      if (r.el.matches(':focus-visible')) focusRing(ctx, ox + 70, b.y + (r.depth ? 1 : 7), 264, r.depth ? r.h - 2 : 31, '#fff');
      ctx.restore();
    }
    return this.moving;
  }
  // #endregion floor-guide
}
customElements.define('floor-guide', FloorGuide);
