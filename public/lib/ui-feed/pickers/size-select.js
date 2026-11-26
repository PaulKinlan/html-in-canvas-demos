// <size-select>: a <details> whose list is radios, drawn as a shoe size drop-down.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, lerp, spring, TAU } from '../kit.js';
import { Fold, cached } from '../fold.js';

const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const HEAVY = "'Arial Black', 'Helvetica Neue', 'Roboto', Arial, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

function drawShoe(g) {
  // a running shoe seen from the side, toe to the left, all in one colour as in the original photograph
  const base = '#eb9a0e', dark = '#cf8206', deep = '#b06a03', light = '#f8b83c', pale = '#fcca62';
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.save(); g.filter = 'blur(7px)'; g.fillStyle = 'rgba(120,60,0,0.5)'; g.beginPath(); g.ellipse(186, 214, 164, 8, 0, 0, TAU); g.fill(); g.restore();
  // the upper: a low toe, the throat rising to the tongue, a dip for the ankle and a tab at the heel
  const upper = new Path2D('M8 176 C12 152 38 140 70 131 C110 120 150 100 184 72 C194 62 208 56 220 62 C240 80 262 98 288 94 C306 90 320 76 329 64 C336 56 345 60 345 72 C347 104 352 134 354 160 L354 186 L8 186 Z');
  const body = g.createLinearGradient(0, 56, 0, 190); body.addColorStop(0, light); body.addColorStop(0.5, base); body.addColorStop(1, dark);
  g.fillStyle = body; g.fill(upper);
  g.save(); g.clip(upper);
  // the mesh
  g.strokeStyle = 'rgba(150,84,0,0.28)'; g.lineWidth = 0.6;
  for (let i = -20; i < 80; i++) { g.beginPath(); g.moveTo(i * 6, 50); g.lineTo(i * 6 + 100, 190); g.stroke(); g.beginPath(); g.moveTo(i * 6 + 100, 50); g.lineTo(i * 6, 190); g.stroke(); }
  // suede: over the toe, a band along the sole, and the counter round the heel
  const suede = g.createLinearGradient(0, 100, 0, 190); suede.addColorStop(0, base); suede.addColorStop(1, deep);
  g.fillStyle = suede;
  g.beginPath(); g.moveTo(0, 190); g.lineTo(0, 150); g.bezierCurveTo(30, 138, 60, 132, 84, 136); g.bezierCurveTo(100, 150, 110, 166, 112, 190); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(100, 190); g.lineTo(106, 168); g.bezierCurveTo(160, 172, 220, 164, 268, 146); g.bezierCurveTo(284, 130, 292, 112, 294, 92); g.lineTo(360, 50); g.lineTo(360, 190); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,214,120,0.6)'; g.lineWidth = 1; g.setLineDash([3, 2.4]);
  g.beginPath(); g.moveTo(10, 152); g.bezierCurveTo(34, 142, 60, 136, 82, 140); g.bezierCurveTo(97, 153, 106, 166, 108, 184); g.stroke();
  g.beginPath(); g.moveTo(110, 172); g.bezierCurveTo(162, 176, 222, 168, 270, 149); g.bezierCurveTo(287, 132, 295, 114, 297, 95); g.stroke();
  g.setLineDash([]);
  // a stripe of lighter suede across the side
  g.strokeStyle = 'rgba(252,202,98,0.5)'; g.lineWidth = 9; g.beginPath(); g.moveTo(150, 160); g.bezierCurveTo(190, 150, 230, 126, 258, 96); g.stroke();
  // the panel that holds the eyelets
  g.fillStyle = dark; g.beginPath(); g.moveTo(112, 124); g.bezierCurveTo(146, 108, 172, 86, 192, 68); g.lineTo(222, 66); g.bezierCurveTo(200, 96, 170, 122, 138, 138); g.closePath(); g.fill();
  g.restore();
  // the padded collar and the pull tab
  g.strokeStyle = deep; g.lineWidth = 6; g.beginPath(); g.moveTo(222, 64); g.bezierCurveTo(240, 82, 262, 99, 288, 95); g.bezierCurveTo(306, 91, 320, 77, 329, 65); g.stroke();
  g.strokeStyle = pale; g.lineWidth = 1.2; g.beginPath(); g.moveTo(223, 61); g.bezierCurveTo(241, 79, 263, 96, 288, 92); g.bezierCurveTo(305, 88, 319, 74, 328, 62); g.stroke();
  // laces
  for (let i = 0; i < 6; i++) {
    const t = i / 5, x = lerp(126, 196, t), y = lerp(124, 70, t);
    g.strokeStyle = deep; g.lineWidth = 6.2; g.beginPath(); g.moveTo(x - 8, y - 7); g.lineTo(x + 13, y + 8); g.stroke();
    g.strokeStyle = light; g.lineWidth = 4.2; g.beginPath(); g.moveTo(x - 8, y - 7); g.lineTo(x + 13, y + 8); g.stroke();
  }
  g.strokeStyle = light; g.lineWidth = 3.4; g.beginPath(); g.moveTo(204, 64); g.bezierCurveTo(196, 44, 220, 40, 222, 58); g.stroke();
  // the sole: a thick foam band that curls up at the toe and the heel, with the tread under it
  const sole = new Path2D('M4 178 C2 166 10 162 22 166 C90 180 150 184 210 180 C262 176 308 166 346 154 C356 152 360 162 358 178 C356 198 350 206 336 208 L30 210 C14 210 6 198 4 178 Z');
  const foam = g.createLinearGradient(0, 152, 0, 210); foam.addColorStop(0, pale); foam.addColorStop(0.55, light); foam.addColorStop(1, base);
  g.fillStyle = foam; g.fill(sole);
  g.save(); g.clip(sole);
  g.strokeStyle = 'rgba(190,110,0,0.5)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(20, 192); g.bezierCurveTo(100, 202, 180, 182, 250, 190); g.bezierCurveTo(300, 196, 330, 180, 358, 170); g.stroke();
  g.fillStyle = dark; g.fillRect(0, 203, 360, 10);
  g.fillStyle = light; for (let x = 12; x < 350; x += 9) g.fillRect(x, 203, 5, 3);
  g.restore();
}

export class SizeSelect extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOX = { x: 195, y: 16, w: 149, head: 77, gap: 6 };
  static css = `
    details { width: 149px; color: #fff; font: 600 11px/1 ${SANS}; }
    summary { display: block; position: relative; height: 77px; background: #17130f; cursor: pointer; }
    summary::-webkit-details-marker { display: none; }
    summary small { position: absolute; left: 11px; top: 11px; font: 700 9px/1 ${SANS}; letter-spacing: 0.04em; }
    summary b { position: absolute; left: 9px; top: 21px; font: 900 49px/1 ${HEAVY}; letter-spacing: -0.04em; }
    summary span { position: absolute; right: 11px; bottom: 12px; font: 600 11px/1 ${SANS}; }
    .list { margin-top: 6px; background: #fff; color: #17130f; }
    label { display: flex; align-items: center; justify-content: space-between; position: relative; height: 31px; padding: 0 11px; box-sizing: border-box; cursor: pointer; }
    label + label { box-shadow: inset 0 1px #e6e1da; }
    label b { font: 900 20px/1 ${HEAVY}; letter-spacing: -0.03em; }
    label span { font: 600 10px/1 ${SANS}; color: #55504a; }
    label input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    label:has(:checked) { background: #17130f; color: #fff; box-shadow: none; }
    label:has(:checked) span { color: #fff; }
    label:has(:checked) b { font-style: italic; }
    label:has(:checked) b::after { content: ''; display: inline-block; width: 9px; height: 4px; margin-left: 9px; border-left: 2px solid; border-bottom: 2px solid; transform: translateY(-6px) rotate(-45deg); }
    label:has(:disabled) { cursor: default; }
    label:has(:disabled) b { color: #b9b4ad; text-decoration: line-through; }
    label:has(:disabled) span { color: #a39e97; }
    label:has(:focus-visible) { outline: 2px solid #f09a00; outline-offset: -2px; }
    summary:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.fit = { x: 0.5, v: 0 };
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['label', 'disabled', 'data-alt'] });
    const root = this.shadowRoot;
    root.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    // A click on a row closes the list. A click that an arrow key sends to the radio does not.
    root.addEventListener('click', (e) => {
      const label = e.target.closest?.('label');
      if (!label || label.querySelector('input').disabled) return;
      if (e.target.localName !== 'input') { this.byHand = true; return; }
      if (this.byHand) { this.byHand = false; this.toggle(false); }
    });
    root.addEventListener('keydown', (e) => {
      if (!this.fold?.open) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && e.target.type === 'radio')) { e.preventDefault(); this.toggle(false); }
    });
    root.addEventListener('pointerdown', (e) => { if (e.target === this.canvas && this.fold.open) this.toggle(false); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region size-select
  build() {
    const sizes = this.sizes = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    const rows = sizes.map((o) => `<label><input type="radio" name="size" value="${esc(o.value)}"${o.disabled ? ' disabled' : ''}><b>${esc(o.label)}</b><span>${esc(o.disabled ? 'Sold out' : o.data.alt ?? '')}</span></label>`).join('');
    const d = this.details = node(`<details><summary><small>${esc(this.getAttribute('label') ?? 'Size')}</small><b></b><span></span></summary><div class="list" role="radiogroup" aria-label="${esc(this.getAttribute('label') ?? 'Size')}">${rows}</div></details>`);
    box.replaceChildren(d);
    this.radios = [...d.querySelectorAll('input')];
    const at = Math.max(0, sizes.findIndex((o) => o.value === was), was ? -1 : sizes.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.fold = new Fold(this, d, 0.26);
    d.firstElementChild.addEventListener('click', (e) => { if (this.plain) return; e.preventDefault(); this.toggle(!this.fold.open); });
    this.sync();
  }
  // Open or close the list. The element closes when the canvas has drawn it shut (Fold, in fold.js).
  toggle(open) {
    if (this.plain) { this.details.open = open; return; }
    const inside = this.shadowRoot.activeElement && this.details.contains(this.shadowRoot.activeElement);
    this.fold.set(open);
    if (open) this.radios[this.index]?.focus({ preventScroll: true });
    else if (inside) this.details.firstElementChild.focus({ preventScroll: true });
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v) && !r.disabled; this.sync(); this.request(); }
  sync() {
    const o = this.sizes[this.index], head = this.details.firstElementChild;
    head.querySelector('b').textContent = o?.label ?? '';
    head.querySelector('span').textContent = o?.data.alt ?? '';
    this.setValue(this.value);
  }

  draw(ctx, w, h) {
    const B = SizeSelect.BOX, d = this.details, wasOpen = d.open;
    let moving = this.fold.step(this.dt);
    // In the frame where the element closes, its box is already short and its picture is still the open one.
    // Drawn at the new size it would be squashed, so that frame uses the height it had.
    const shut = wasOpen && !d.open, tall = shut ? this.tall : d.offsetHeight;
    this.tall = tall; moving = moving || shut;
    const e = this.fold.e, n = Math.max(1, this.radios.length - 1);
    moving = spring(this.fit, this.index / n, this.dt, 230, 24) || moving;
    const wall = ctx.createLinearGradient(0, 0, w, h); wall.addColorStop(0, '#fbb01f'); wall.addColorStop(0.6, '#f7a315'); wall.addColorStop(1, '#ee9608');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
    // the shoe grows a little with the size, about the middle of its sole
    const s = lerp(0.86, 1.02, this.fit.x), shoe = cached(this, 'shoe', 360, 226, drawShoe);
    ctx.drawImage(shoe, 180 - 180 * s, 338 - 212 * s, 360 * s, 226 * s);
    // the box: the summary, and as much of the list as is open
    ctx.save();
    ctx.shadowColor = 'rgba(90,40,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#17130f'; ctx.fillRect(B.x, B.y, B.w, B.head);
    if (e > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(B.x, B.y + B.head + B.gap, B.w, this.fold.h * e - B.gap * e); }
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.head + this.fold.h * e); ctx.clip();
    put(ctx, d, B.x, B.y, B.w, tall);
    ctx.restore();
    // the chevron turns over as the list opens
    ctx.save(); ctx.translate(B.x + B.w - 17, B.y + 16); ctx.scale(1, lerp(1, -1, e));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-5, -2.5); ctx.lineTo(0, 2.5); ctx.lineTo(5, -2.5); ctx.stroke(); ctx.restore();
    return moving;
  }
  // #endregion size-select
}
customElements.define('size-select', SizeSelect);
