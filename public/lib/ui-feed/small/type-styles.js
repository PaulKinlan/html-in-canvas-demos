// <type-styles>: a carousel of typefaces on a radio group, with cards squeezed from one row.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, rr, spring } from '../kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const local = (el, e) => { const r = el.canvas.getBoundingClientRect(), k = r.width / el.constructor.size[0]; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');
const ring = (ctx, x, y, w, h, r, colour = '#fff') => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); };

export class TypeStyles extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static CARD = { w: 200, h: 248, gap: 14, top: 36 };
  static css = `
    .row { display: flex; gap: 14px; }
    .card { flex: none; width: 200px; height: 248px; padding: 0 20px 22px; box-sizing: border-box; display: grid; grid-template-rows: 1fr auto; align-items: center; justify-items: center; background: #24130d; border-radius: 22px; color: #fbe9d6; }
    .card b { display: inline-block; font-size: 96px; line-height: 1; font-weight: 400; }
    .card span { justify-self: start; font: 600 15px/1 ${SANS}; }
    .dots { display: flex; gap: 0; }
    .dots label { width: 22px; height: 22px; } .dots input { width: 22px; height: 22px; margin: 0; opacity: 0; cursor: pointer; }
    .grab { width: 360px; height: 248px; touch-action: pan-y; cursor: grab; }`;

  ready() {
    this.pos = { x: 0, v: 0 };
    this.build();
  }

  // #region type-styles
  build() {
    const box = this.canvas ?? this.$('.plain'), name = this.getAttribute('name') ?? 'style';
    this.styles = options(this);
    const start = Math.max(0, this.styles.findIndex((o) => o.selected));
    // Each card names a typeface. The <option>'s data-style is the CSS of its "Aa".
    this.row = node(`<div class="row" aria-hidden="true">${this.styles.map((o) => `<div class="card"><b style="${esc(o.data.style ?? '')}">${esc(o.data.sample ?? 'Aa')}</b><span>${esc(o.label)}</span></div>`).join('')}</div>`);
    // The value is a radio group, one radio a dot: arrows move it, and it is what the form sends.
    this.dots = node(`<div class="dots" role="radiogroup" aria-label="${esc(this.getAttribute('label') ?? 'Type style')}">${this.styles.map((o, i) => `<label><input type="radio" name="${esc(name)}" value="${esc(o.value)}" aria-label="${esc(o.label)}" ${i === start ? 'checked' : ''}></label>`).join('')}</div>`);
    this.radios = [...this.dots.querySelectorAll('input')];
    this.grab = node('<div class="grab" aria-hidden="true"></div>');
    box.replaceChildren(this.row, this.grab, this.dots);
    this.pos.x = start;
    this.dots.addEventListener('change', () => this.sync());
    // A drag across the cards moves the row with the finger and lets go to the nearest card.
    let drag = null;
    // No focus from a press on the cards: delegatesFocus would send it to the first radio, not the chosen one.
    this.grab.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = { x: local(this, e).x, at: this.pos.x }; try { this.grab.setPointerCapture(e.pointerId); } catch {} });
    this.grab.addEventListener('pointermove', (e) => { if (!drag) return; const dx = local(this, e).x - drag.x; if (Math.abs(dx) > 4) drag.moved = true; this.pos.x = clamp(drag.at - dx / 130, -0.3, this.styles.length - 0.7); this.pos.v = 0; this.request(); });
    const end = (e) => {
      if (!drag) return;
      let i = Math.round(this.pos.x);
      // a tap on a card at the side goes to that card
      if (!drag.moved && e.type === 'pointerup') { const x = local(this, e).x; if (x < 80) i = Math.round(drag.at) - 1; else if (x > 280) i = Math.round(drag.at) + 1; }
      drag = null; this.pick(clamp(i, 0, this.styles.length - 1));
    };
    this.grab.addEventListener('pointerup', end); this.grab.addEventListener('pointercancel', end);
    this.sync();
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  pick(i) { if (this.radios.includes(this.shadowRoot.activeElement)) this.radios[i].focus({ preventScroll: true }); if (!this.radios[i].checked) { this.radios[i].checked = true; this.radios[i].dispatchEvent(new Event('change', { bubbles: true })); } else this.request(); }
  sync() { this.setValue(this.radios[this.index].value); this.request(); }

  draw(ctx, w, h) {
    const C = TypeStyles.CARD, n = this.styles.length;
    ctx.fillStyle = '#ff9a57'; ctx.fillRect(0, 0, w, h);
    const moving = spring(this.pos, this.index, this.dt, 170, 22);
    const p = this.pos.x;
    // A card's width falls as it moves from the middle; the row is laid out from those widths so that the
    // middle of the card at `p` sits in the middle of the canvas.
    const width = (d) => C.w * Math.max(0.3, 1 - 0.4 * Math.min(d, 1) - 0.15 * Math.max(0, d - 1));
    const ws = this.styles.map((_, i) => width(Math.abs(i - p))), xs = [];
    let x = 0; ws.forEach((cw, i) => { xs[i] = x; x += cw + C.gap; });
    const i0 = clamp(Math.floor(p), 0, n - 1), i1 = clamp(i0 + 1, 0, n - 1), k = p - i0;
    const mid = lerp(xs[i0] + ws[i0] / 2, xs[i1] + ws[i1] / 2, i0 === i1 ? 0 : k), shift = 180 - mid;
    this.styles.forEach((_, i) => {
      const cx = xs[i] + shift, cw = ws[i];
      if (cx > w || cx + cw < 0) return;
      ctx.save();
      rr(ctx, cx, C.top, cw, C.h, 22); ctx.clip();
      // the card squeezed to its width: a slice of the row, scaled across
      ctx.translate(cx, C.top); ctx.scale(cw / C.w, 1);
      put(ctx, this.row, -i * (C.w + C.gap), 0, this.row.offsetWidth, C.h);
      ctx.restore();
    });
    hit(ctx, this.row, -2000, 0);
    hit(ctx, this.grab, 0, C.top, 360, C.h);
    // the dots: the chosen one is a bar, and each takes the pointer as its radio
    const D = { x: 180 - n * 11, y: C.top + C.h + 22 };
    put(ctx, this.dots, D.x, D.y - 11); hit(ctx, this.dots, D.x, D.y - 11);
    this.styles.forEach((_, i) => {
      const on = clamp(1 - Math.abs(i - p)), dw = lerp(6, 18, on), cx = D.x + i * 22 + 11;
      ctx.fillStyle = `rgba(36,19,13,${lerp(0.45, 1, on)})`; rr(ctx, cx - dw / 2, D.y - 3, dw, 6, 3); ctx.fill();
    });
    if (this.radios.some((r) => fv(this, r))) ring(ctx, D.x - 4, D.y - 13, n * 22 + 8, 26, 13, '#24130d');
    return moving;
  }
  // #endregion type-styles
}
customElements.define('type-styles', TypeStyles);
