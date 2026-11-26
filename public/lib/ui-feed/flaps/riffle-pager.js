// <riffle-pager>: pagination drawn as a riffled deck of cards over slotted <section> pages.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, clamp, lerp, easeOut, rr, reduced } from '../kit.js';

// #region riffle-pager
// Pagination drawn as a deck of cards. A page is a <section> of light DOM, drawn with a transform; the
// cards behind are the same page's picture, so one element stands in for the whole deck.
export class RifflePager extends FeedControl {
  static size = [360, 340];
  static html = `<div class="sheet"><slot></slot></div><nav aria-label="Pages"></nav>`;
  static css = `
    .sheet { width: 252px; color: #1a1a1a; font: 15px/1.45 Georgia, 'Times New Roman', serif; }
    ::slotted(section) { box-sizing: border-box; width: 252px; height: 168px; padding: 16px 18px;
      background: #fffdf6; border: 1px solid #ddd6c2; border-radius: 10px; }
    nav { display: flex; gap: 6px; width: 320px; }
    button { min-width: 38px; height: 40px; margin: 0; padding: 0 6px; border: 1px solid #c7bfa8; border-radius: 6px;
      background: #fffdf6; color: #2c2a24; font: 15px/38px Georgia, 'Times New Roman', serif; outline: 0; touch-action: manipulation; }
    button[aria-current] { background: #2c2a24; border-color: #2c2a24; color: #fffdf6; }
    button:disabled { color: #b4ac97; }
    button:focus-visible { border-color: #2c2a24; box-shadow: inset 0 0 0 2px #2c2a24; }`;

  ready() {
    this.sheet = this.$('.sheet'); this.nav = this.$('nav');
    this.page = 0; this.turned = -1e9; this.from = 0;
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.go(b.dataset.p === 'prev' ? this.page - 1 : b.dataset.p === 'next' ? this.page + 1 : +b.dataset.p);
    });
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true });
    this.sync();
  }
  get pages() { return [...this.querySelectorAll(':scope > section')]; }
  get value() { return String(this.page + 1); }
  go(to) {
    to = clamp(to, 0, this.pages.length - 1);
    if (to === this.page) return;
    this.from = this.page; this.page = to; this.turned = performance.now();
    this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {
    const n = this.pages.length, focus = this.shadowRoot.activeElement?.dataset?.p;
    this.page = clamp(this.page, 0, Math.max(0, n - 1));
    const show = [...new Set([0, this.page - 1, this.page, this.page + 1, n - 1])].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    let html = `<button type="button" data-p="prev" aria-label="Previous page"${this.page === 0 ? ' disabled' : ''}>←</button>`;
    let last = -1;
    for (const i of show) {
      if (i - last > 1) html += `<button type="button" disabled aria-hidden="true">…</button>`;
      html += `<button type="button" data-p="${i}" aria-label="Page ${i + 1}"${i === this.page ? ' aria-current="page"' : ''}>${i + 1}</button>`;
      last = i;
    }
    html += `<button type="button" data-p="next" aria-label="Next page"${this.page >= n - 1 ? ' disabled' : ''}>→</button>`;
    this.nav.innerHTML = html;
    if (focus != null) (this.nav.querySelector(`[data-p="${focus}"]:not(:disabled)`) ?? this.nav.querySelector('[aria-current]'))?.focus();
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    const pages = this.pages, n = pages.length, card = pages[this.page];
    ctx.fillStyle = '#e7e2d4';
    ctx.fillRect(0, 0, w, h);
    const cw = 252, ch = 168, cx = (w - cw) / 2, cy = 34;
    const t = reduced() ? 1 : clamp((now - this.turned) / 520);
    const dir = Math.sign(this.page - this.from) || 1;
    // the deck: the same card drawn small and dark behind, one for each page that is left
    const behind = Math.min(6, n - 1);
    for (let i = behind; i >= 1; i--) {
      const k = i / Math.max(1, behind);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(cx + cw / 2, cy + ch / 2);
      ctx.rotate(lerp(0, 0.07, k) * dir);
      ctx.translate(-cw / 2, -ch / 2 + k * 8);
      ctx.fillStyle = '#d8d1bd';
      rr(ctx, 0, 0, cw, ch, 10); ctx.fill();
      ctx.restore();
    }
    // the card on top, riffling in. The page is slotted, so what is drawn is a slice of the drawable
    // <div> that holds the slot, clipped to the card: a slotted element has no picture of its own.
    if (card) {
      const s = this.slice(card);
      ctx.save();
      ctx.translate(cx + cw / 2, cy + ch / 2);
      if (t < 1) {
        const e = easeOut(t);
        ctx.rotate(lerp(0.55 * dir, 0, e));
        ctx.translate(lerp(150 * dir, 0, e), lerp(60, 0, e));
        ctx.scale(lerp(0.86, 1, e), lerp(0.86, 1, e));
        ctx.globalAlpha = lerp(0.2, 1, e);
      }
      ctx.shadowColor = 'rgba(40,34,20,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#fffdf6';
      rr(ctx, -cw / 2, -ch / 2, cw, ch, 10); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      rr(ctx, -cw / 2, -ch / 2, cw, ch, 10); ctx.clip();
      put(ctx, this.sheet, -cw / 2, -ch / 2 - s.top, s.w, s.h);
      ctx.restore();
    }
    put(ctx, this.nav, 20, 240);
    hit(ctx, this.nav, 20, 240);
    ctx.fillStyle = '#6a6354';
    ctx.font = '14px Georgia, serif';
    ctx.fillText(`Card ${this.page + 1} of ${n}`, 20, 310);
    return t < 1;
  }
}
customElements.define('riffle-pager', RifflePager);
// #endregion riffle-pager
