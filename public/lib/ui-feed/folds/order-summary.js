// <order-summary>: one <details> whose item pictures move from a row to a column as it opens.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, clamp, lerp, smooth, TAU, reduced } from '../kit.js';
import { Fold, wire, cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const money = (n, sign = '€') => sign + Number(n).toFixed(2);

// A picture of one thing on a red ground, in a square of 100 units.
function drawThing(g, kind, seed = 1) {
  const ground = g.createLinearGradient(0, 0, 100, 100); ground.addColorStop(0, '#ee3a22'); ground.addColorStop(1, '#e02d18');
  g.fillStyle = ground; g.fillRect(0, 0, 100, 100);
  const shadow = (x, y, rx, ry) => { g.save(); g.filter = 'blur(1.6px)'; g.fillStyle = 'rgba(120,10,0,0.55)'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); g.restore(); };
  if (kind === 'vase') {
    shadow(64, 91, 30, 4.5);
    const body = () => { g.beginPath(); g.moveTo(40, 6); g.lineTo(60, 6); g.quadraticCurveTo(58, 12, 57, 22); g.bezierCurveTo(88, 34, 96, 80, 66, 93); g.lineTo(36, 93); g.bezierCurveTo(4, 80, 12, 34, 43, 22); g.quadraticCurveTo(42, 12, 40, 6); g.closePath(); };
    const clay = g.createLinearGradient(14, 0, 90, 0); clay.addColorStop(0, '#f1ebe1'); clay.addColorStop(0.55, '#e6ded1'); clay.addColorStop(1, '#b3a797');
    g.fillStyle = clay; body(); g.fill();
    g.save(); body(); g.clip();
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(95,80,62,${0.25 + rnd(seed + i) * 0.4})`; g.fillRect(12 + rnd(i * 3 + 1) * 76, 8 + rnd(i * 5 + 2) * 84, 0.8, 0.8); }
    g.strokeStyle = 'rgba(120,105,88,0.16)'; g.lineWidth = 0.5;
    for (let y = 28; y < 92; y += 4) { g.beginPath(); g.moveTo(8, y); g.quadraticCurveTo(50, y + 2.5, 94, y); g.stroke(); }
    g.restore();
    g.fillStyle = '#cfc6b8'; g.beginPath(); g.ellipse(50, 6, 10, 2.2, 0, 0, TAU); g.fill();
    g.fillStyle = '#6f6557'; g.beginPath(); g.ellipse(50, 6.2, 7.6, 1.3, 0, 0, TAU); g.fill();
  } else if (kind === 'lamp') {
    shadow(60, 92, 26, 3.6);
    const brass = (x0, x1) => { const m = g.createLinearGradient(x0, 0, x1, 0); for (const [at, c] of [[0, '#8a5d12'], [0.25, '#f5d98a'], [0.5, '#c8962f'], [0.8, '#8f6214'], [1, '#d8ad4e']]) m.addColorStop(at, c); return m; };
    g.fillStyle = brass(47, 53); g.fillRect(48.2, 34, 3.6, 54);
    g.fillStyle = brass(28, 72); g.beginPath(); g.ellipse(50, 90, 21, 4, 0, 0, TAU); g.fill();
    g.fillStyle = '#7a520f'; g.beginPath(); g.ellipse(50, 91.6, 21, 3.2, 0, 0, Math.PI); g.fill();
    g.fillStyle = brass(24, 76); g.beginPath(); g.moveTo(22, 40); g.bezierCurveTo(22, 4, 78, 4, 78, 40); g.closePath(); g.fill();
    g.fillStyle = '#6e4a0c'; g.beginPath(); g.ellipse(50, 40, 28, 3.4, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,246,214,0.75)'; g.beginPath(); g.ellipse(38, 20, 3, 8, 0.5, 0, TAU); g.fill();
  } else if (kind === 'book') {
    shadow(66, 92, 30, 3.4);
    g.fillStyle = '#e9e4d8'; g.beginPath(); g.moveTo(20, 88); g.lineTo(76, 88); g.lineTo(80, 92); g.lineTo(24, 92); g.closePath(); g.fill();
    const cloth = g.createLinearGradient(18, 0, 80, 0); cloth.addColorStop(0, '#16307e'); cloth.addColorStop(0.08, '#0f246a'); cloth.addColorStop(0.12, '#1b3a93'); cloth.addColorStop(1, '#122a78');
    g.fillStyle = cloth; g.beginPath(); g.moveTo(18, 12); g.lineTo(74, 9); g.lineTo(76, 88); g.lineTo(20, 88); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 12; y < 88; y += 1.6) g.fillRect(19, y, 56, 0.5);
    g.fillStyle = '#efeadf'; g.beginPath(); g.moveTo(64, 9.6); g.lineTo(67.4, 9.4); g.lineTo(69.2, 88); g.lineTo(65.8, 88); g.closePath(); g.fill();
    g.fillStyle = '#e9e4d8'; g.fillRect(30, 88, 1.4, 6);
  } else {
    shadow(60, 90, 30, 4);
    g.fillStyle = '#d9b98a'; g.fillRect(24, 30, 52, 58); g.fillStyle = '#c4a172'; g.fillRect(24, 30, 52, 12); g.fillStyle = '#efe2c8'; g.fillRect(46, 30, 8, 58);
  }
}

export class OrderSummary extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    details { width: 338px; font: 400 12px/1.25 ${SANS}; color: #6b5f5c; }
    summary { display: flex; justify-content: space-between; align-items: flex-start; height: 55px; padding: 10px 13px 0; box-sizing: border-box; cursor: pointer; touch-action: manipulation; outline: none; }
    summary::-webkit-details-marker { display: none; }
    summary b { display: inline-block; font: 700 16.5px/20px ${SANS}; letter-spacing: -0.03em; color: #1b1413; }
    summary small { display: block; font-size: 11.5px; }
    details[open] .show, details:not([open]) .hide { display: none; }
    .sum { font: 300 19.5px/26px ${SANS}; letter-spacing: -0.02em; color: #1b1413; margin-top: 4px; }
    ul { list-style: none; margin: 0; padding: 0 13px; }
    li { position: relative; height: 73px; padding: 13px 0 0 84px; box-sizing: border-box; }
    li b { display: block; font: 700 15.5px/19px ${SANS}; letter-spacing: -0.03em; color: #1b1413; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
    li small { display: block; font-size: 11px; line-height: 16px; white-space: nowrap; }
    li data { position: absolute; right: 0; top: 13px; font: 400 15px/19px ${SANS}; color: #1b1413; }
    footer { display: flex; justify-content: space-between; align-items: flex-end; margin: 3px 13px 0; padding-top: 9px; border-top: 0.7px solid #dccfd3; height: 56px; box-sizing: border-box; }
    dl { display: grid; grid-template-columns: auto auto; gap: 1px 14px; margin: 0; font-size: 11.5px; line-height: 16px; }
    dd { margin: 0; text-align: right; }
    .total { margin: 0; text-align: right; font: 700 10.5px/1 ${SANS}; color: #1b1413; }
    .total data { font: 700 25px/26px ${SANS}; letter-spacing: -0.04em; margin-left: 5px; }
    .total small { display: block; font: 400 11px/16px ${SANS}; color: #6b5f5c; }`;
  static CLOSED = { y: 96.5, h: 167 }; static OPEN = { y: 11, h: 338 };

  ready() {
    this.details = document.createElement('details'); this.details.setAttribute('drawable', '');
    this.details.open = this.hasAttribute('open');
    (this.canvas ?? this.$('.plain')).append(this.details);
    this.build();
    this.fold = new Fold(this, this.details, 0.5); wire(this, [this.fold]);
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-price', 'data-note', 'data-qty', 'data-art', 'shipping', 'vat', 'currency'] });
    this.sync();
  }
  // #region order-summary
  build() {
    const sign = this.getAttribute('currency') ?? '€', ship = Number(this.getAttribute('shipping') ?? 0), vat = Number(this.getAttribute('vat') ?? 0);
    const items = this.items = options(this).map((o) => ({ name: o.label, note: o.data.note ?? '', qty: Number(o.data.qty ?? 1), price: Number(o.data.price ?? 0), art: o.data.art ?? '' }));
    const sub = items.reduce((s, it) => s + it.price * it.qty, 0), total = this.total = sub + ship, count = items.reduce((s, it) => s + it.qty, 0);
    this.details.innerHTML = `
      <summary><span><b class="show">Show order summary</b><b class="hide">Hide order summary</b><small>${count} item${count === 1 ? '' : 's'}</small></span><data class="sum" value="${total.toFixed(2)}">${money(total, sign)}</data></summary>
      <ul>${items.map((it) => `<li><b>${esc(it.name)}</b><data value="${(it.price * it.qty).toFixed(2)}">${money(it.price * it.qty, sign)}</data><small>${esc(it.note)}</small><small>Qty ${it.qty}</small></li>`).join('')}</ul>
      <footer><dl><dt>Subtotal</dt><dd>${money(sub, sign)}</dd><dt>Shipping</dt><dd>${money(ship, sign)}</dd></dl>
        <p class="total">Total <data value="${total.toFixed(2)}">${money(total, sign)}</data>${vat ? `<small>Including ${money(total * vat / (100 + vat), sign)} VAT</small>` : ''}</p></footer>`;
    this.pictures?.clear();
    if (this.fold) wire(this, [this.fold]);              // the summary is a new element
    this.request();
  }
  get open() { return this.fold.open; }
  set open(v) { this.fold.set(Boolean(v)); this.sync(); }
  sync() { this.setValue(this.fold?.open ? 'open' : 'closed'); }
  pick() { this.fold.set(!this.fold.open); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }

  draw(ctx, w, h) {
    const { CLOSED, OPEN } = OrderSummary, f = this.fold, moving = f.step(this.dt), e = f.e;
    const top = lerp(CLOSED.y, OPEN.y, e), tall = lerp(CLOSED.h, OPEN.h, e), head = this.details.firstElementChild;
    ctx.fillStyle = '#e8331f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(11, top, 338, tall);
    ctx.save(); ctx.beginPath(); ctx.rect(11, top, 338, tall); ctx.clip();
    put(ctx, this.details, 11, top);
    // The rows of text arrive after the pictures have left the row: white is drawn over them until then.
    const veil = 1 - smooth((f.t - 0.4) / 0.6);
    if (f.t > 0 && veil > 0) { ctx.fillStyle = `rgba(255,255,255,${veil})`; ctx.fillRect(11, top + 55, 338, tall - 55); }
    // the chevron after the words turns over
    const label = head.querySelector(f.d.open && f.t > 0.5 ? '.hide' : '.show') ?? head.querySelector('b'), cx = 11 + 13 + (label.offsetWidth || 150) + 15;
    ctx.translate(cx, top + 21); ctx.rotate(e * Math.PI); ctx.strokeStyle = '#e8331f'; ctx.lineWidth = 2; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(-5.5, -2.8); ctx.lineTo(0, 2.8); ctx.lineTo(5.5, -2.8); ctx.stroke();
    ctx.restore();
    // #region order-pictures
    // Each picture goes from its place in the row to its place in the column, one after another.
    this.items.forEach((it, i) => {
      const k = reduced() ? e : smooth(clamp(f.t * 1.35 - i * 0.12)), n = Math.max(3, this.items.length);
      const row = { x: 24 + i * (312 - 99) / (n - 1), y: top + 55, s: 99 }, col = { x: 24, y: top + 55 + 3 + i * 73, s: 70 };
      const x = lerp(row.x, col.x, k), y = lerp(row.y, col.y, k), s = lerp(row.s, col.s, k);
      ctx.drawImage(cached(this, `thing${i}`, 100, 100, (g) => drawThing(g, it.art, i + 1)), x, y, s, s);
    });
    // #endregion order-pictures
    if (head.matches(':focus-visible')) focusRing(ctx, 15, top + 4, 330, 47, '#1b1413');
    return moving;
  }
  // #endregion order-summary
}
customElements.define('order-summary', OrderSummary);
