// <page-marker>: pagination buttons in a <nav> with a stretching red marker and filtered ink.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, clamp, spring } from '../kit.js';

const DIDONE = "'Bodoni Moda', 'Playfair Display', Didot, 'Bodoni 72', 'Bodoni MT', 'Libre Bodoni', 'Liberation Serif', 'Times New Roman', serif";
const changed = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

// Draw an element, then draw it again inside a rectangle with a fill behind it and a filter that turns its
// ink into `ink`. This is how a marker "inverts" the text it passes over with no second copy of the text.
const TO_PAPER = 'brightness(0) invert(0.94) sepia(0.22)';
function marker(ctx, el, x, y, r, fill, filter) {
  if (r.w <= 0.5 || r.h <= 0.5) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.filter = filter;
  put(ctx, el, x, y);
  ctx.restore();
}

const ARROW = '<svg viewBox="0 0 44 14" aria-hidden="true"><path d="M0 7h42M35.5 1.5 42 7l-6.5 5.5"/></svg>';

// #region page-marker
//   <page-marker name="page" pages="5" value="2"></page-marker>
// The pages are <button>s in a <nav>, with aria-current="page" on the one you're on. The canvas draws the
// nav, then draws it again inside the red marker with a filter that turns black ink into paper.
export class PageMarker extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static html = `<p class="where"></p><nav aria-label="Pagination"><ul></ul></nav>`;
  static css = `
    .where { width: 318px; font: 400 19px/1 ${DIDONE}; color: #161310; }
    nav { width: 318px; color: #161310; }
    ul { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
    li.n { flex: 0 0 calc(100% / var(--n)); }
    li.step { flex: 1 1 50%; padding-top: 10px; }
    li.later { text-align: right; }
    button { all: unset; box-sizing: border-box; cursor: pointer; color: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .num { display: block; width: 100%; height: 112px; text-align: center; font: 400 80px/114px ${DIDONE}; }
    .num:focus-visible { box-shadow: inset 0 -6px 0 currentColor; }
    .num:active { transform: translateY(2px); }
    .step button { display: inline-flex; gap: 9px; align-items: center; padding: 6px 0; font: italic 400 22px/1.1 ${DIDONE}; }
    .step button:focus-visible { box-shadow: inset 0 -2px 0 currentColor; }
    .prev svg { transform: scaleX(-1); }
    .step button:active:not([aria-disabled=true]) { transform: translateX(var(--nudge)); }
    .prev { --nudge: -4px; } .next { --nudge: 4px; }
    .step button[aria-disabled=true] { opacity: 0.25; cursor: default; }
    svg { width: 30px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.3; }`;

  ready() {
    this.where = this.$('.where'); this.nav = this.$('nav');
    const n = this.pages = clamp(+this.getAttribute('pages') || 5, 2, 9);
    this.nav.style.setProperty('--n', n);
    const ul = this.$('ul');
    ul.innerHTML = Array.from({ length: n }, (_, i) => `<li class="n"><button type="button" class="num" data-p="${i + 1}" aria-label="Page ${i + 1}">${i + 1}</button></li>`).join('') +
      `<li class="step"><button type="button" class="prev" data-step="-1">${ARROW}Previous</button></li>` +
      `<li class="step later"><button type="button" class="next" data-step="1">Next${ARROW}</button></li>`;
    this.nums = this.$$('.num');
    const p = clamp(+this.getAttribute('value') || 1, 1, n);
    this.L = { x: p - 1, v: 0 }; this.R = { x: p, v: 0 }; this.lead = 1;
    ul.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      this.go(b.dataset.p ? +b.dataset.p : this.page + +b.dataset.step);
    });
    this.go(p, true);
  }
  get value() { return String(this.page); }
  set value(v) { this.go(+v); }
  go(p, quiet = false) {
    p = clamp(Math.round(p) || 1, 1, this.pages);
    if (p === this.page) return;
    this.lead = p > (this.page ?? p) ? 1 : -1;
    this.page = p;
    this.nums.forEach((b, i) => { if (i + 1 === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    // aria-disabled rather than disabled, so a button keeps focus when you reach the end with it
    this.$('.prev').setAttribute('aria-disabled', p === 1);
    this.$('.next').setAttribute('aria-disabled', p === this.pages);
    this.where.textContent = `Page ${p} of ${this.pages}`;
    this.setValue(String(p));
    if (!quiet) changed(this);
    this.request();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#efe8dc'; ctx.fillRect(0, 0, w, h);
    const X = 21, Y = 122, W = 318, H = 112, cw = W / this.pages;
    put(ctx, this.where, X, Y - 36);
    ctx.fillStyle = '#161310';
    ctx.fillRect(X, Y - 1.5, W, 1.5); ctx.fillRect(X, Y + H, W, 1.5);
    put(ctx, this.nav, X, Y);
    // The edge in the direction of travel is stiff and the other is soft, so the marker stretches over the
    // pages in between and then catches up.
    const fast = [520, 40], slow = [150, 21], to = this.page;
    const [kl, cl] = this.lead < 0 ? fast : slow, [kr, cr] = this.lead > 0 ? fast : slow;
    const a = spring(this.L, to - 1, this.dt, kl, cl), b = spring(this.R, to, this.dt, kr, cr);
    const x0 = X + Math.min(this.L.x, this.R.x - 0.2) * cw, x1 = X + Math.max(this.R.x, this.L.x + 0.2) * cw;
    marker(ctx, this.nav, X, Y, { x: x0, y: Y, w: x1 - x0, h: H }, '#e3261c', TO_PAPER);
    return a || b;
  }
}
customElements.define('page-marker', PageMarker);
// #endregion page-marker
