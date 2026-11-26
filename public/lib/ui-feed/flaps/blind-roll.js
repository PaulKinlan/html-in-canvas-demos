// <blind-roll>: bus destination roller blind backed by a scroll-snapping native scroller.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, options, esc, clamp, rr, reduced } from '../kit.js';

// #region blind-roll
// The original is a scroll area, so the control is one: a native scroller 150 px tall over a list of
// destinations, one 72 px line each, with scroll snapping. The canvas draws the scroller's own picture, so
// the scrolling, the snapping, the fling and the arrow keys are the browser's. The chosen stop is the
// snapped line, which the element reports to the form.
export class BlindRoll extends FeedControl {
  static size = [360, 300];
  static ROW = 72;
  static html = `<div class="window" tabindex="0" role="listbox" aria-label="Destination"><div class="roll"></div></div>
    <button type="button" class="step" data-d="-1" aria-label="Previous destination">↑</button>
    <button type="button" class="step" data-d="1" aria-label="Next destination">↓</button>`;
  static css = `
    .window { width: 320px; height: 150px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none;
      scroll-snap-type: y mandatory; background: #efb100; }
    .roll { color: #f4c20a; font: 700 26px/72px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif;
      text-transform: uppercase; letter-spacing: 0.5px; padding: 39px 0; }
    .roll div { display: flex; gap: 12px; align-items: baseline; height: 72px; padding: 0 16px; box-sizing: border-box;
      scroll-snap-align: center; mix-blend-mode: multiply; }
    .roll b { font-size: 21px; font-weight: 400; opacity: .8; min-width: 24px; }
    .roll span { overflow: hidden; white-space: nowrap; }
    .step { width: 44px; height: 44px; margin: 0; padding: 0; border: 1px solid #585042; border-radius: 6px;
      background: #241f16; color: #f4c20a; font: 20px/40px system-ui, sans-serif; outline: 0; touch-action: manipulation; }
    .step:focus-visible { border-color: #fff; }`;

  ready() {
    this.win = this.$('.window'); this.roll = this.$('.roll');
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    // A scroll of an element inside a drawable canvas raises paint by itself; the index and the form value
    // are worked out from scrollTop.
    this.win.addEventListener('scroll', () => { this.send(); }, { passive: true });
    this.shadowRoot.addEventListener('click', (e) => {
      const b = e.target.closest('.step');
      if (b) this.go(this.index + +b.dataset.d);
    });
  }
  get index() { return Math.round(this.win.scrollTop / BlindRoll.ROW); }
  get stops() { return [...this.querySelectorAll(':scope > option')]; }
  get value() { return this.stops[clamp(this.index, 0, this.stops.length - 1)]?.getAttribute('value') ?? ''; }
  set value(v) { const i = this.stops.findIndex((o) => o.getAttribute('value') === String(v)); if (i >= 0) this.go(i); }
  go(i, smooth = true) {
    i = clamp(i, 0, this.stops.length - 1);
    this.win.scrollTo({ top: i * BlindRoll.ROW, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  }
  send() {
    const v = this.value;
    if (v !== this.sent) { this.sent = v; this.setValue(v); this.dispatchEvent(new Event('change', { bubbles: true })); }
    this.request();
  }
  sync() {
    const list = options(this), at = list.findIndex((o) => o.selected);
    this.roll.innerHTML = list.map((o) => `<div><b>${esc(o.data.number ?? '')}</b><span>${esc(o.label)}</span></div>`).join('');
    this.go(Math.max(0, at), false);
    this.sent = undefined;
    this.send();
  }
  draw(ctx, w, h) {
    const win = { x: 20, y: 48, w: 320, h: 150 };
    ctx.fillStyle = '#17140e';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    rr(ctx, win.x, win.y, win.w, win.h, 8);
    ctx.clip();
    // the scroller's own picture: its scroll position, its clipping and its snapping are already in it
    put(ctx, this.win, win.x, win.y, win.w, win.h);
    const sh = ctx.createLinearGradient(0, win.y, 0, win.y + 30);
    sh.addColorStop(0, 'rgba(60,40,0,0.55)'); sh.addColorStop(1, 'rgba(60,40,0,0)');
    ctx.fillStyle = sh; ctx.fillRect(win.x, win.y, win.w, 30);
    const sb = ctx.createLinearGradient(0, win.y + win.h - 30, 0, win.y + win.h);
    sb.addColorStop(0, 'rgba(60,40,0,0)'); sb.addColorStop(1, 'rgba(60,40,0,0.55)');
    ctx.fillStyle = sb; ctx.fillRect(win.x, win.y + win.h - 30, win.w, 30);
    ctx.restore();
    ctx.strokeStyle = '#3a3222'; ctx.lineWidth = 3;
    rr(ctx, win.x, win.y, win.w, win.h, 8); ctx.stroke();
    ctx.fillStyle = '#2b2519';
    for (const y of [win.y - 14, win.y + win.h + 2]) { rr(ctx, win.x + 10, y, win.w - 20, 12, 6); ctx.fill(); }
    const steps = this.$$('.step');
    put(ctx, steps[0], w - 60, 214);
    put(ctx, steps[1], w - 60, 260);
    if (this.win.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); rr(ctx, win.x + 4, win.y + 4, win.w - 8, win.h - 8, 6); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#c9b482';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('DESTINATION', 22, 36);
    ctx.letterSpacing = '0px';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#8d7f5f';
    ctx.fillText(`Stop ${clamp(this.index, 0, this.stops.length - 1) + 1} of ${this.stops.length}`, 22, 232);
    ctx.fillText('Drag the blind, or use the arrow keys', 22, 254);
    return false;
  }
}
customElements.define('blind-roll', BlindRoll);
// #endregion blind-roll
