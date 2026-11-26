// <file-tree>: editor file explorer built from nested <details> folders and radio file rows.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc } from '../kit.js';
import { Fold, focusRing } from '../fold.js';

const MONO = "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const BADGE = { json: '{}', md: 'MD' };

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

export class FileTree extends TreeControl {
  static size = [360, 360];
  static radius = 3;
  static ORIGIN = [0, 12];
  static seconds = 0.26;
  static css = `
    .tree { width: 360px; color: #0a0a0a; font: 500 17px/28px ${MONO}; }
    summary, .leaf { display: flex; align-items: center; height: 28px; padding: 0 13px 0 47px; position: relative; box-sizing: border-box; cursor: pointer; touch-action: manipulation; outline: none; white-space: nowrap; }
    summary { font-weight: 800; font-size: 18px; }
    summary::-webkit-details-marker { display: none; }
    .tree > .leaf { padding-left: 13px; }
    .leaf input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .badge { flex: none; width: 27px; margin-right: 7px; font: 800 8.5px/14px ${MONO}; text-align: center; color: #ff6a13; background: #0a0a0a; }
    .st { margin-left: auto; width: 17px; font: 800 12px/17px ${MONO}; text-align: center; color: #fff; background: #0a0a0a; }
    summary i { margin-left: auto; margin-right: 5px; width: 6px; height: 6px; background: currentColor; }
    .on { background: #0a0a0a; color: #fff; }
    .on .badge { background: #ff6a13; color: #0a0a0a; }
    .on .st { background: #fff; color: #0a0a0a; }`;
  static observedAttributes = ['value'];

  // #region file-tree
  render(nodes) {
    return nodes.map((n) => {
      if (n.children) return `<details${n.open ? ' open' : ''}><summary>${esc(n.label)}${'changed' in n.data ? '<i title="has changes"></i>' : ''}</summary><div class="kids">${this.render(n.children)}</div></details>`;
      const ext = n.label.split('.').pop().toLowerCase(), status = n.data.status ?? '';
      return `<label class="leaf"><input type="radio" name="file" value="${esc(n.path)}"><span class="badge">${esc(BADGE[ext] ?? ext.toUpperCase().slice(0, 3))}</span>${esc(n.label)}${status ? `<b class="st" title="${status === 'U' ? 'untracked' : 'modified'}">${esc(status)}</b>` : ''}</label>`;
    }).join('');
  }
  build() {
    const was = this.root.querySelector('input:checked')?.value ?? this.getAttribute('value');
    super.build();
    if (!this.wired) { this.wired = true; this.root.addEventListener('change', (e) => { this.mark(e.target.closest('.leaf')); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }); }
    const radio = [...this.root.querySelectorAll('input')].find((r) => r.value === was);
    if (radio) { radio.checked = true; this.mark(radio.closest('.leaf')); this.sync(); }
  }
  attributeChangedCallback(_, __, v) { if (this.root && v !== null && v !== this.value) this.value = v; }
  get value() { return this.root.querySelector('input:checked')?.value ?? ''; }
  set value(v) { const r = [...this.root.querySelectorAll('input')].find((x) => x.value === String(v)); if (r) { r.checked = true; this.mark(r.closest('.leaf')); this.sync(); this.request(); } }
  sync() { this.setValue(this.value || null); }

  draw(ctx, w, h) {
    const rows = this.step(), [, oy] = FileTree.ORIGIN;
    ctx.fillStyle = '#ff6a13'; ctx.fillRect(0, 0, w, h);
    this.paint(ctx, rows);
    rows.forEach((r, i) => {
      const b = this.band(r); if (!b) return;
      if (r.d) {
        // the chevron turns down, and a rule runs beside the folder's files for as far as they show
        ctx.save(); ctx.beginPath(); ctx.rect(0, b.a, w, b.b - b.a); ctx.clip();
        ctx.translate(26.5, b.y + 14); ctx.rotate(r.fold.e * Math.PI / 2); ctx.strokeStyle = r.el === this.marked ? '#fff' : '#0a0a0a'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-2.6, -4.6); ctx.lineTo(2.4, 0); ctx.lineTo(-2.6, 4.6); ctx.stroke(); ctx.restore();
        if (r.fold.t > 0) { let end = r.y + r.h; for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++) end = Math.max(end, Math.min(rows[j].y + rows[j].h, rows[j].bottom)); ctx.fillStyle = '#0a0a0a'; ctx.fillRect(26, b.y + r.h, 0.8, Math.max(0, oy + end - b.y - r.h - 2)); }
      }
      const focus = r.d ? r.el : r.el.querySelector('input');
      if (focus?.matches(':focus-visible')) focusRing(ctx, 3, b.y + 2, w - 6, r.h - 4, r.el === this.marked ? '#fff' : '#0a0a0a');
    });
    return this.moving;
  }
  // #endregion file-tree
}
customElements.define('file-tree', FileTree);
