// <lift-pager>: pagination drawn as a lift floor indicator over slotted <section> pages.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, spring } from '../kit.js';

// #region lift-pager
// Pagination drawn as a lift floor indicator. The pages are the element's light DOM: one <section> each.
export class LiftPager extends FeedControl {
  static size = [360, 330];
  static html = `<div class="sheet"><slot></slot></div><nav aria-label="Floors"></nav>`;
  static css = `
    .sheet { width: 320px; color: #1c1c1c; font: 15px/1.5 system-ui, sans-serif; }
    ::slotted(section) { box-sizing: border-box; width: 320px; height: 122px; padding: 2px 16px; overflow: hidden; }
    ::slotted(section) > * { margin: 4px 0 !important; }
    nav { display: flex; gap: 10px; width: 320px; }
    button { width: 60px; height: 60px; margin: 0; padding: 0; border: 2px solid #8d8d8d; border-radius: 50%;
      background: radial-gradient(circle at 38% 32%, #fdfdfd, #c9c9c9 72%, #9a9a9a 100%); color: #222;
      font: 600 22px/56px system-ui, sans-serif; outline: 0; touch-action: manipulation; }
    button:disabled { color: #a0a0a0; }
    button:focus-visible { border-color: #0a63c9; box-shadow: 0 0 0 3px rgba(10,99,201,0.4); }`;

  ready() {
    this.sheet = this.$('.sheet'); this.nav = this.$('nav');
    this.page = 0; this.pos = { x: 0, v: 0 };
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.go(this.page + +b.dataset.d);
    });
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true });
    this.sync();
  }
  get pages() { return [...this.querySelectorAll(':scope > section')]; }
  get value() { return String(this.page + 1); }
  go(to) {
    to = clamp(to, 0, this.pages.length - 1);
    if (to === this.page) return;
    this.page = to;
    this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {
    const n = this.pages.length;
    this.page = clamp(this.page, 0, Math.max(0, n - 1));
    this.nav.innerHTML = `<button type="button" data-d="-1" aria-label="Previous floor"${this.page === 0 ? ' disabled' : ''}>‹</button>
      <button type="button" data-d="1" aria-label="Next floor"${this.page >= n - 1 ? ' disabled' : ''}>›</button>`;
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h) {
    const pages = this.pages, n = pages.length;
    const moving = spring(this.pos, this.page, this.dt, 90, 15);
    ctx.fillStyle = '#d9d7d2';
    ctx.fillRect(0, 0, w, h);
    // the brushed panel
    const panel = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 24; i++) panel.addColorStop(i / 24, i % 2 ? '#c7c6c2' : '#d6d5d1');
    ctx.fillStyle = panel;
    rr(ctx, 12, 12, w - 24, 110, 10); ctx.fill();
    ctx.strokeStyle = '#a8a7a3'; ctx.lineWidth = 1.5; ctx.stroke();
    // the floor numbers, with the travelling light over the current one
    const pitch = (w - 80) / Math.max(1, n);
    ctx.font = '600 34px "Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const x = 48 + (i + 0.5) * pitch, lit = 1 - clamp(Math.abs(this.pos.x - i));
      ctx.fillStyle = `rgb(${Math.round(lerp(120, 220, lit))}, ${Math.round(lerp(118, 60, lit))}, ${Math.round(lerp(114, 40, lit))})`;
      if (lit > 0.02) { ctx.shadowColor = `rgba(220,60,30,${lit * 0.9})`; ctx.shadowBlur = 18 * lit; }
      ctx.fillText(pages[i].dataset.floor ?? String(i + 1), x, 56);
      ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // the arrow, pointing the way the lift is going
    const dir = Math.abs(this.pos.v) < 0.05 ? 0 : Math.sign(this.pos.v);
    ctx.fillStyle = dir ? '#d8411e' : '#9a9995';
    ctx.save();
    ctx.translate(w / 2, 98);
    if (dir < 0) ctx.rotate(Math.PI);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(10, 7); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // the page, as a card that slides in from the direction of travel
    const card = { x: 20, y: 136, w: 320, h: 130 };
    ctx.save();
    rr(ctx, card.x, card.y, card.w, card.h, 8);
    ctx.clip();
    ctx.fillStyle = '#fbfaf8';
    ctx.fillRect(card.x, card.y, card.w, card.h);
    const frac = this.pos.x - Math.round(this.pos.x);
    const near = pages[clamp(Math.round(this.pos.x), 0, n - 1)];
    // The pages are slotted, so they are drawn as a slice of the drawable <div> that holds the slot.
    if (near) { const s = this.slice(near); put(ctx, this.sheet, card.x, card.y + 4 - frac * 60 - s.top, s.w, s.h); }
    ctx.restore();
    ctx.strokeStyle = '#b6b4b0'; ctx.lineWidth = 1.5;
    rr(ctx, card.x, card.y, card.w, card.h, 8); ctx.stroke();
    // The call buttons are drawn as one <nav>: a descendant of a drawable element cannot be drawn on its own.
    put(ctx, this.nav, 20, 266);
    hit(ctx, this.nav, 20, 266);
    ctx.fillStyle = '#6d6b67';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Floor ${this.page + 1} of ${n}`, 160, 302);
    return moving;
  }
}
customElements.define('lift-pager', LiftPager);
// #endregion lift-pager
