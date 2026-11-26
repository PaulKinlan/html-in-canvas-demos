// <led-pager>: pagination over a slotted <table> drawn as an LED departures board.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, dotBoard, clamp, reduced } from '../kit.js';

const clock = (d = new Date()) => d.toTimeString().slice(0, 8);
// Tick once a second while the control is in the page. The new text changes the picture, which raises paint.
function everySecond(el, fn) {
  fn();
  const id = setInterval(() => { if (!el.isConnected) clearInterval(id); else if (!document.hidden) fn(); }, 1000);
}

// #region led-pager
//   <led-pager name="page" rows="5">        pages through the rows of a slotted table
//     <table><thead>…</thead><tbody><tr>…</tr>…</tbody></table>
//   </led-pager>
// The table stays in the page's own DOM and keeps the page's own CSS. It is slotted into a drawable <div>
// inside the canvas, and a page is a clipped draw of that one picture. No row is hidden or moved.
export class LedPager extends FeedControl {
  static size = [360, 380];
  static html = `<div class="sheet"><slot></slot></div><output class="status"><span></span><span></span></output><nav aria-label="Pages"></nav>`;
  static css = `
    .sheet { width: 344px; color: #ffb62e; font: 700 22px/40px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }
    ::slotted(table) { width: 100%; border-spacing: 0; table-layout: fixed; font: inherit; color: inherit; }
    .status { display: flex; justify-content: space-between; width: 344px; height: 40px; color: #ffb62e; font: 700 22px/40px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }
    nav { display: flex; gap: 8px; width: 344px; }
    button { flex: 1; height: 60px; margin: 0; padding: 0; border: 4px solid #6b4a12; border-radius: 0; background: #1c1305; color: #ffb62e; font: 700 38px/1 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; outline: none; touch-action: manipulation; }
    button[aria-current] { background: #ffb62e; color: #1c1305; border-color: #ffb62e; }
    button:disabled { color: #5a3f10; border-color: #33240a; }
    button:focus-visible { border-color: #fff; }`;

  ready() {
    this.page = 0; this.prev = 0; this.turned = -1e9;
    this.nav = this.$('nav'); this.sheet = this.$('.sheet'); this.status = this.$('.status');
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const to = b.dataset.p === 'prev' ? this.page - 1 : b.dataset.p === 'next' ? this.page + 1 : +b.dataset.p;
      this.go(to);
    });
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true });
    this.sync();
    everySecond(this, () => { this.status.lastChild.textContent = clock(); });
  }
  get per() { return Math.max(1, +this.getAttribute('rows') || 5); }
  get rows() { return [...(this.querySelector('table')?.tBodies[0]?.rows ?? [])]; }
  get pages() { return Math.max(1, Math.ceil(this.rows.length / this.per)); }
  get value() { return String(this.page + 1); }
  go(to) {
    to = clamp(to, 0, this.pages - 1);
    if (to === this.page) return;
    this.prev = this.page; this.page = to; this.turned = performance.now();
    this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {
    const n = this.pages, focus = this.shadowRoot.activeElement?.dataset?.p;
    this.page = clamp(this.page, 0, n - 1);
    this.nav.innerHTML = `<button type="button" data-p="prev" aria-label="Previous page"${this.page === 0 ? ' disabled' : ''}>&lsaquo;</button>` +
      Array.from({ length: n }, (_, i) => `<button type="button" data-p="${i}" aria-label="Page ${i + 1}"${i === this.page ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('') +
      `<button type="button" data-p="next" aria-label="Next page"${this.page === n - 1 ? ' disabled' : ''}>&rsaquo;</button>`;
    if (focus != null) (this.nav.querySelector(`[data-p="${focus}"]:not(:disabled)`) ?? this.nav.querySelector('[aria-current]'))?.focus();
    this.status.firstChild.textContent = `Page ${this.page + 1} of ${n}`;
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#120a02';
    ctx.fillRect(0, 0, w, h);
    const rows = this.rows, per = this.per, table = this.querySelector('table');
    const rowH = rows[0]?.offsetHeight || 40, headH = rows[0]?.offsetTop || 0;
    const age = now - this.turned, step = reduced() ? 0 : 70;
    const top = headH + per * rowH, W = this.sheet.offsetWidth;
    const b = dotBoard(this, ctx, { x: 8, y: 8, w: w - 16, h: h - 16, cell: 2.2, bg: '#140b02', off: 0.05, glow: 1.6 }, (c) => {
      const slice = (y, hh, dy) => { c.save(); c.beginPath(); c.rect(0, y, W, hh); c.clip(); put(c, this.sheet, 0, dy); c.restore(); };
      if (table && headH) slice(0, headH, 0);
      // each line of the board changes to the new page a little after the one above it
      for (let j = 0; j < per; j++) {
        const r = rows[(age > j * step ? this.page : this.prev) * per + j];
        if (r) slice(headH + j * rowH, rowH, headH + j * rowH - r.offsetTop);
      }
      put(c, this.status, 0, top + 2);
      put(c, this.nav, 0, top + 48);
    });
    hit(ctx, this.nav, b.ox, b.oy + top + 48);
    return age < per * step + 50;
  }
}
customElements.define('led-pager', LedPager);
// #endregion led-pager
