// ui-feed/pickers.js: five controls for choosing one thing, rebuilt from demos on ui-feed.dev.
//
//   <size-select name value>      a <details> whose list is radios, drawn as a drop-down of shoe sizes
//   <part-popovers name>          a <button> and a non-modal <dialog> for each part of a bicycle
//   <glaze-radios name value>     radios drawn as a segmented control. The mug is glazed again at each change
//   <crossword-entry name>        one <input type="text"> across a row of a crossword, and the grid as a <table>
//   <tulip-carousel name value>   a scroll-snap scroller of slides, with a radio for each slide
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /picker-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, easeOut, rr, spring, TAU, reduced } from './kit.js';
import { Fold, cached, focusRing } from './folds.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const HEAVY = "'Arial Black', 'Helvetica Neue', 'Roboto', Arial, sans-serif";
const SLAB = "Rockwell, 'Rockwell Nova', 'Roboto Slab', 'Zilla Slab', 'Noto Serif', 'DejaVu Serif', Georgia, serif";
const NARROW = "'Cormorant Garamond', 'Bodoni 72 Smallcaps', 'Didot', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
// A point of a pointer event, in the control's design units.
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
const mix = (a, b, t) => { const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// ---------------------------------------------------------------------------------------------------------
// Shoe size: a drop-down made of a <details> and radios
// ---------------------------------------------------------------------------------------------------------

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
  // Open or close the list. The element closes when the canvas has drawn it shut (Fold, in folds.js).
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

// ---------------------------------------------------------------------------------------------------------
// Bicycle parts: a button and a non-modal <dialog> for each part
// ---------------------------------------------------------------------------------------------------------

function drawBike(g) {
  const green = '#12381f', greenLight = '#2a6a3c', cream = '#efe2c4', tan = '#b9652a', steel = '#c9ccd0';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const rear = { x: 66, y: 268 }, front = { x: 272, y: 268 }, R = 52, bb = { x: 160, y: 272 }, seat = { x: 124, y: 172 }, head = { x: 226, y: 150 };
  const line = (pts, colour, width) => { g.strokeStyle = colour; g.lineWidth = width; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); };
  for (const c of [rear, front]) {
    // spokes, rim and a cream tyre
    g.strokeStyle = 'rgba(235,235,240,0.75)'; g.lineWidth = 0.5;
    for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, b = a + (i % 2 ? 0.5 : -0.5); g.beginPath(); g.moveTo(c.x + Math.cos(b) * 5, c.y + Math.sin(b) * 5); g.lineTo(c.x + Math.cos(a) * (R - 6), c.y + Math.sin(a) * (R - 6)); g.stroke(); }
    g.strokeStyle = cream; g.lineWidth = 6.5; g.beginPath(); g.arc(c.x, c.y, R - 3, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(120,96,60,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.stroke();
    g.strokeStyle = steel; g.lineWidth = 1.6; g.beginPath(); g.arc(c.x, c.y, R - 7.5, 0, TAU); g.stroke();
    g.fillStyle = '#8d9096'; g.beginPath(); g.arc(c.x, c.y, 4, 0, TAU); g.fill();
  }
  // mudguards
  g.strokeStyle = green; g.lineWidth = 3.4;
  g.beginPath(); g.arc(rear.x, rear.y, R + 5, Math.PI * 0.98, Math.PI * 1.92); g.stroke();
  g.beginPath(); g.arc(front.x, front.y, R + 5, Math.PI * 1.12, Math.PI * 1.98); g.stroke();
  // the rack over the back wheel
  line([seat.x + 8, 204, 20, 204], green, 2.6); line([24, 204, rear.x, rear.y], green, 1.6); line([70, 204, rear.x, rear.y], green, 1.6); line([seat.x + 4, 214, 22, 210], green, 1.4);
  // the frame: seat tube, two swept tubes down from the head tube, stays and fork
  line([bb.x, bb.y, seat.x + 3, seat.y + 10], green, 5);
  g.strokeStyle = green; g.lineWidth = 4.6;
  g.beginPath(); g.moveTo(head.x + 1, head.y + 18); g.bezierCurveTo(214, 230, 190, 262, bb.x, bb.y); g.stroke();
  g.beginPath(); g.moveTo(head.x + 3, head.y + 32); g.bezierCurveTo(222, 232, 196, 250, bb.x - 8, bb.y - 34); g.stroke();
  line([bb.x - 16, bb.y - 60, rear.x, rear.y], green, 3.2);
  line([head.x, head.y, head.x + 5, head.y + 40], green, 6);
  g.strokeStyle = green; g.lineWidth = 3.6; g.beginPath(); g.moveTo(head.x + 5, head.y + 40); g.quadraticCurveTo(250, 232, front.x, front.y); g.stroke();
  g.strokeStyle = greenLight; g.lineWidth = 1; g.beginPath(); g.moveTo(head.x, head.y + 20); g.bezierCurveTo(213, 230, 189, 261, bb.x + 2, bb.y - 2); g.stroke();
  // the chain case
  g.fillStyle = green; g.beginPath(); g.moveTo(rear.x - 4, rear.y - 9); g.lineTo(bb.x + 4, bb.y - 17); g.arc(bb.x + 2, bb.y, 17, -Math.PI / 2, Math.PI / 2); g.lineTo(rear.x - 4, rear.y + 8); g.arc(rear.x - 4, rear.y, 8.5, Math.PI / 2, -Math.PI / 2); g.closePath(); g.fill();
  g.strokeStyle = greenLight; g.lineWidth = 1; g.beginPath(); g.moveTo(rear.x, rear.y - 7); g.lineTo(bb.x + 2, bb.y - 14); g.stroke();
  // crank, pedal and stand
  line([bb.x + 2, bb.y, bb.x + 16, bb.y + 22], steel, 2.6); line([bb.x + 10, bb.y + 23, bb.x + 24, bb.y + 23], '#3a3a3a', 3.4);
  g.fillStyle = steel; g.beginPath(); g.arc(bb.x + 2, bb.y, 3, 0, TAU); g.fill();
  line([bb.x - 8, bb.y + 8, bb.x + 4, 331], steel, 2);
  // seat post and saddle with its springs
  line([seat.x + 3, seat.y + 12, seat.x + 1, seat.y - 2], steel, 2.6);
  g.strokeStyle = steel; g.lineWidth = 1; for (const sx of [seat.x - 12, seat.x + 12]) { g.beginPath(); for (let i = 0; i <= 12; i++) g.lineTo(sx + (i % 2 ? 2.6 : -2.6), seat.y - 2 + i * 0.8); g.stroke(); }
  const leather = g.createLinearGradient(0, seat.y - 14, 0, seat.y); leather.addColorStop(0, '#d98a4a'); leather.addColorStop(1, '#9a4a16');
  g.fillStyle = leather; g.beginPath(); g.moveTo(seat.x - 24, seat.y - 6); g.bezierCurveTo(seat.x - 22, seat.y - 15, seat.x - 6, seat.y - 12, seat.x + 4, seat.y - 9); g.bezierCurveTo(seat.x + 14, seat.y - 7, seat.x + 24, seat.y - 9, seat.x + 27, seat.y - 5); g.bezierCurveTo(seat.x + 18, seat.y - 1, seat.x + 4, seat.y + 1, seat.x - 6, seat.y); g.bezierCurveTo(seat.x - 16, seat.y, seat.x - 25, seat.y - 1, seat.x - 24, seat.y - 6); g.fill();
  // stem, bars and grips
  line([head.x, head.y, head.x - 3, head.y - 16], steel, 3);
  g.strokeStyle = steel; g.lineWidth = 2.4; g.beginPath(); g.moveTo(head.x - 3, head.y - 16); g.quadraticCurveTo(head.x + 8, head.y - 24, head.x - 12, head.y - 16); g.lineTo(head.x - 32, head.y - 13); g.stroke();
  line([head.x - 22, head.y - 14.5, head.x - 36, head.y - 12.5], tan, 4.6);
  // the bell
  g.fillStyle = '#e5c15a'; g.beginPath(); g.arc(head.x + 2, head.y - 19, 4.6, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(head.x + 0.6, head.y - 20.6, 1.5, 0, TAU); g.fill();
  // the basket: rattan woven in two directions
  const bx = head.x + 14, by = head.y - 2, bw = 56, bh = 40;
  const wick = g.createLinearGradient(bx, by, bx + bw, by + bh); wick.addColorStop(0, '#d79a52'); wick.addColorStop(1, '#a8662a');
  const shape = new Path2D(); shape.moveTo(bx, by); shape.lineTo(bx + bw, by - 3); shape.lineTo(bx + bw - 7, by + bh); shape.lineTo(bx + 6, by + bh + 1); shape.closePath();
  g.fillStyle = wick; g.fill(shape);
  g.save(); g.clip(shape);
  g.lineWidth = 1; for (let i = -10; i < 30; i++) { g.strokeStyle = 'rgba(96,52,14,0.55)'; g.beginPath(); g.moveTo(bx + i * 5, by - 4); g.lineTo(bx + i * 5 + 24, by + bh + 2); g.stroke(); g.strokeStyle = 'rgba(255,220,160,0.4)'; g.beginPath(); g.moveTo(bx + i * 5 + 24, by - 4); g.lineTo(bx + i * 5, by + bh + 2); g.stroke(); }
  g.restore();
  g.strokeStyle = '#8a5220'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(bx - 1, by); g.lineTo(bx + bw + 1, by - 3); g.stroke();
  // the lamp on the fork
  g.fillStyle = steel; g.beginPath(); g.ellipse(head.x + 24, head.y + 50, 6.5, 5.5, 0, 0, TAU); g.fill();
  g.fillStyle = '#fff6c9'; g.beginPath(); g.ellipse(head.x + 28, head.y + 50, 3, 4.6, 0, 0, TAU); g.fill();
}
function drawBikeScene(g) {
  const wall = g.createLinearGradient(0, 0, 360, 330); wall.addColorStop(0, '#f2477c'); wall.addColorStop(1, '#e83b70');
  g.fillStyle = wall; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,160,190' : '150,20,60'},${0.05 + rnd(i + 9) * 0.07})`; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 330, 1 + rnd(i + 3) * 2, 1); }
  const floor = g.createLinearGradient(0, 326, 0, 360); floor.addColorStop(0, '#b99a8e'); floor.addColorStop(0.2, '#d2b9ad'); floor.addColorStop(1, '#c6aa9d');
  g.fillStyle = floor; g.fillRect(0, 327, 360, 33);
  // the bicycle is drawn once on its own picture: again in one dark colour for the shadow on the wall
  const c = document.createElement('canvas'), k = g.getTransform().a; c.width = Math.ceil(360 * k); c.height = Math.ceil(360 * k);
  const b = c.getContext('2d'); b.scale(k, k); drawBike(b);
  g.save(); g.filter = 'brightness(0) blur(2.5px)'; g.globalAlpha = 0.2; g.drawImage(c, 22, 5, 360, 360); g.restore();
  g.save(); g.filter = 'blur(4px)'; g.fillStyle = 'rgba(70,30,30,0.35)'; g.beginPath(); g.ellipse(180, 331, 150, 5, 0, 0, TAU); g.fill(); g.restore();
  g.drawImage(c, 0, 0, 360, 360);
}

export class PartPopovers extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static CARD = 160;
  static css = `
    button.dot { width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
    dialog { width: 160px; padding: 13px 13px 13px; border: 0; background: #fff; color: #111; inset: auto; left: 0; top: 0; font: 500 10.5px/1.3 ${SANS}; }
    dialog h3 { margin: 0; font: 800 32px/1 ${SANS}; letter-spacing: -0.05em; }
    dialog p { margin: 6px 0 12px; }
    dialog form { display: flex; align-items: center; justify-content: space-between; margin: 0; }
    dialog data { font: 700 24px/1 ${SANS}; letter-spacing: -0.02em; }
    dialog button { width: 54px; height: 29px; padding: 0; border: 0; border-radius: 15px; background: #111; color: #fff; font: 700 11.5px/1 ${SANS}; cursor: pointer; }
    dialog button:focus-visible { outline: 2px solid #e83b70; outline-offset: 2px; }
    output { left: auto; top: auto; padding: 6px 10px 6px; background: #111; color: #fff; border-radius: 14px; font: 700 11px/1 ${SANS}; white-space: nowrap; }`;

  ready() {
    this.added = new Set((this.getAttribute('value') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-at', 'data-price', 'data-note', 'value'] });
    const root = this.shadowRoot;
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.parts.some((p) => p.want)) { e.preventDefault(); this.show(-1, true); } });
    root.addEventListener('pointerdown', (e) => { if (e.target === this.canvas) this.show(-1); });
  }

  // #region part-popovers
  build() {
    const box = this.canvas ?? this.$('.plain'), money = (n) => '$' + Number(n).toLocaleString('en-US');
    box.replaceChildren();
    this.parts = options(this).map((o, i) => {
      const [x, y] = (o.data.at ?? '').split(',').map(Number);
      const button = node(`<button type="button" class="dot" aria-haspopup="dialog" aria-expanded="false" aria-controls="part${i}">${esc(o.label)}</button>`);
      const dialog = node(`<dialog id="part${i}" aria-label="${esc(o.label)}"><h3>${esc(o.label)}</h3><p>${esc(o.data.note ?? '')}</p><form method="dialog"><data value="${esc(o.data.price ?? 0)}">${money(o.data.price ?? 0)}</data><button value="add">Add</button></form></dialog>`);
      box.append(button, dialog);
      const part = { ...o, x: x || 40 + i * 50, y: y || 40, price: Number(o.data.price ?? 0), button, dialog, t: 0, want: 0, pop: { x: 0, v: 0 } };
      button.addEventListener('click', () => this.show(part.want ? -1 : i));
      // The form would close the dialog at once. Cancel that, and close it when it has been drawn shut.
      dialog.querySelector('form').addEventListener('submit', (e) => {
        part.said = e.submitter?.value ?? '';
        if (this.added.has(o.value)) this.added.delete(o.value); else this.added.add(o.value);
        this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
        if (this.plain) return;
        e.preventDefault(); this.show(-1, true);
      });
      return part;
    });
    this.sum = node('<output aria-live="polite"></output>');
    box.append(this.sum);
    this.sync();
  }
  // Open the dialog of one part and close the others. -1 closes them all.
  show(index, refocus = false) {
    this.parts.forEach((p, i) => {
      const open = i === index;
      if (open && !p.dialog.open) {
        p.dialog.open = true;                              // show() would also move focus, and may scroll the page to it
        p.dialog.querySelector('button').focus({ preventScroll: true });
      }
      if (!open && p.want && refocus) p.button.focus({ preventScroll: true });
      if (!open && this.plain && p.dialog.open) p.dialog.close();
      p.want = open ? 1 : 0;
      p.button.setAttribute('aria-expanded', String(open));
    });
    this.request();
  }
  get value() { return this.parts.filter((p) => this.added.has(p.value)).map((p) => p.value).join(','); }
  set value(v) { this.added = new Set(String(v).split(',').map((s) => s.trim()).filter(Boolean)); this.sync(); this.request(); }
  sync() {
    let total = 0, n = 0;
    for (const p of this.parts) {
      const on = this.added.has(p.value);
      if (on) { total += p.price; n++; }
      p.button.setAttribute('aria-label', on ? `${p.label}, added` : p.label);
      p.dialog.querySelector('button').textContent = on ? 'Remove' : 'Add';
      p.dialog.querySelector('button').value = on ? 'remove' : 'add';
    }
    this.sum.value = n ? `${n} ${n === 1 ? 'part' : 'parts'} added, $${total.toLocaleString('en-US')}` : '';
    this.setValue(this.value);
  }
  // Where the card of a part goes: above its button if there is room, else below, and inside the picture.
  place(p) {
    const W = PartPopovers.CARD, H = p.dialog.offsetHeight, above = p.y - 20 - H >= 8;
    return { x: clamp(p.x - W * 0.42, 10, 350 - W), y: above ? p.y - 20 - H : p.y + 20, w: W, h: H, above };
  }

  draw(ctx, w, h) {
    ctx.drawImage(cached(this, 'scene', 360, 360, drawBikeScene), 0, 0, w, h);
    let moving = false;
    const focus = this.shadowRoot.activeElement;
    for (const p of this.parts) {
      if (p.t !== p.want) { p.t = reduced() ? p.want : p.want ? Math.min(1, p.t + this.dt / 0.2) : Math.max(0, p.t - this.dt / 0.14); }
      const springing = p.dialog.open && spring(p.pop, p.want, this.dt, 420, 30);
      moving = moving || p.t !== p.want || springing;
      if (p.t === 0 && !p.want && p.dialog.open) { p.dialog.close(p.said ?? ''); p.said = ''; p.pop.x = p.pop.v = 0; }
    }
    // the buttons: a white disc with a plus that turns into a cross on black, or a tick once the part is added
    for (const p of this.parts) {
      const e = smooth(p.t), on = this.added.has(p.value);
      hit(ctx, p.button, p.x - 18, p.y - 18);
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.fill();
      ctx.fillStyle = mix('#ffffff', '#111111', Math.max(e, on ? 1 : 0)); ctx.beginPath(); ctx.arc(0, 0, 7.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = mix('#111111', '#ffffff', Math.max(e, on ? 1 : 0)); ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (on && e < 0.5) { ctx.beginPath(); ctx.moveTo(-3.2, 0.2); ctx.lineTo(-0.9, 2.5); ctx.lineTo(3.3, -2.3); ctx.stroke(); }
      else { ctx.rotate(e * Math.PI / 4); ctx.beginPath(); ctx.moveTo(-3.2, 0); ctx.lineTo(3.2, 0); ctx.moveTo(0, -3.2); ctx.lineTo(0, 3.2); ctx.stroke(); }
      ctx.restore();
      if (focus === p.button && p.button.matches(':focus-visible')) focusRing(ctx, p.x - 14, p.y - 14, 28, 28);
    }
    // the open cards, grown from their buttons
    for (const p of this.parts) {
      if (!p.dialog.open) continue;
      const c = this.place(p), s = clamp(lerp(0.6, 1, p.pop.x), 0.3, 1.2), a = clamp(p.t * 1.6);
      const tipY = c.above ? p.y - 12 : p.y + 12, x = p.x + (c.x - p.x) * s, y = tipY + ((c.above ? c.y - 8 : c.y + 8) - tipY) * s, cw = c.w * s, ch = c.h * s;
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(150,20,60,0.55)'; ctx.fillRect(x + 3, y + 3, cw, ch);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(p.x, tipY); ctx.lineTo(p.x - 7 * s, c.above ? y + ch - 0.5 : y + 0.5); ctx.lineTo(p.x + 7 * s, c.above ? y + ch - 0.5 : y + 0.5); ctx.closePath(); ctx.fill();
      put(ctx, p.dialog, x, y, cw, ch);
      ctx.restore();
    }
    if (this.sum.value) put(ctx, this.sum, 12, 360 - 12 - this.sum.offsetHeight);
    return moving;
  }
  // #endregion part-popovers
}
customElements.define('part-popovers', PartPopovers);

// ---------------------------------------------------------------------------------------------------------
// Glaze: radios as a segmented control, and a mug that is glazed again from the right
// ---------------------------------------------------------------------------------------------------------

// #region glaze-mug
const GLAZES = {
  celadon: { base: '#a9c5a1', deep: '#7fa682', ridge: '#8fb38e', rim: '#c3d9b9', speck: 'rgba(70,100,70,0.35)', gloss: 0.5, thumb: '#b4cfab' },
  tenmoku: { base: '#231814', deep: '#0e0907', ridge: '#8c3d16', rim: '#a8521f', speck: 'rgba(190,96,40,0.5)', gloss: 0.9, thumb: '#3a2a22' },
  shino: { base: '#efe7dc', deep: '#d9cdbd', ridge: '#eb8a55', rim: '#ef7f45', speck: 'rgba(120,70,40,0.5)', gloss: 0.35, thumb: '#f4e9dc' },
  cobalt: { base: '#2445a8', deep: '#142a72', ridge: '#16307f', rim: '#5d7fd6', speck: 'rgba(10,20,70,0.5)', gloss: 0.8, thumb: '#3557c0' },
};
// A thrown mug, 300 by 250 units, in one glaze. Every glaze is drawn on the same shape so that one can be
// wiped over another.
function drawMug(g, z, seed = 1) {
  const L = 44, Rr = 206, T = 26, B = 220, rim = 13;
  const body = new Path2D(); body.moveTo(L, T); body.lineTo(L + 3, B - 14); body.quadraticCurveTo(L + 4, B, L + 22, B + 2); body.lineTo(Rr - 22, B + 2); body.quadraticCurveTo(Rr - 4, B, Rr - 3, B - 14); body.lineTo(Rr, T); body.ellipse((L + Rr) / 2, T, (Rr - L) / 2, rim, 0, 0, Math.PI, true); body.closePath();
  // the handle, behind the body
  const handle = new Path2D(); handle.moveTo(Rr - 8, 62); handle.bezierCurveTo(Rr + 44, 40, Rr + 66, 78, Rr + 52, 122); handle.bezierCurveTo(Rr + 40, 158, Rr + 14, 168, Rr - 8, 176);
  g.lineCap = 'round';
  g.strokeStyle = z.deep; g.lineWidth = 19; g.stroke(handle);
  g.strokeStyle = z.base; g.lineWidth = 14; g.stroke(handle);
  g.save(); g.translate(-3, -3); g.strokeStyle = `rgba(255,255,255,${0.2 + z.gloss * 0.3})`; g.lineWidth = 3; g.stroke(handle); g.restore();
  g.strokeStyle = z.ridge; g.globalAlpha = 0.5; g.lineWidth = 3; g.save(); g.translate(4, 4); g.stroke(handle); g.restore(); g.globalAlpha = 1;
  // the body
  g.fillStyle = z.base; g.fill(body);
  g.save(); g.clip(body);
  // throwing rings: the glaze pools dark in each groove and breaks on each ridge
  for (let i = 0; i < 10; i++) {
    const y = T + 22 + i * 18 + (rnd(seed + i) - 0.5) * 9, hgt = 4 + rnd(seed + i + 20) * 7;
    const band = g.createLinearGradient(0, y - hgt, 0, y + hgt); band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.5, z.ridge); band.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.25 + rnd(seed + i + 40) * 0.45; g.fillStyle = band;
    g.beginPath(); g.moveTo(L - 2, y - hgt); g.quadraticCurveTo((L + Rr) / 2, y - hgt + 9, Rr + 2, y - hgt); g.lineTo(Rr + 2, y + hgt); g.quadraticCurveTo((L + Rr) / 2, y + hgt + 9, L - 2, y + hgt); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  // speckle, pinholes and runs
  for (let i = 0; i < 260; i++) { g.fillStyle = z.speck; const r = 0.3 + rnd(seed + i * 3) ** 3 * 1.6; g.beginPath(); g.arc(L + rnd(seed + i * 3 + 1) * (Rr - L), T + rnd(seed + i * 3 + 2) * (B - T), r, 0, TAU); g.fill(); }
  // the unglazed foot
  const foot = g.createLinearGradient(0, B - 12, 0, B + 2); foot.addColorStop(0, '#d2a878'); foot.addColorStop(1, '#b98a58');
  g.fillStyle = foot; g.beginPath(); g.moveTo(L - 2, B - 10); g.quadraticCurveTo((L + Rr) / 2, B - 2, Rr + 2, B - 10); g.lineTo(Rr + 2, B + 4); g.lineTo(L - 2, B + 4); g.closePath(); g.fill();
  for (let i = 0; i < 90; i++) { g.fillStyle = rnd(i + 5) > 0.5 ? 'rgba(90,50,20,0.5)' : 'rgba(255,230,190,0.5)'; g.fillRect(L + rnd(seed + i + 300) * (Rr - L), B - 9 + rnd(seed + i + 400) * 11, 1.2, 1.2); }
  // the round of the cylinder: light from the upper left, dark toward the right edge
  const round = g.createLinearGradient(L, 0, Rr, 0); round.addColorStop(0, 'rgba(0,0,0,0.16)'); round.addColorStop(0.16, `rgba(255,255,255,${0.1 + z.gloss * 0.22})`); round.addColorStop(0.34, 'rgba(255,255,255,0)'); round.addColorStop(0.7, 'rgba(0,0,0,0.06)'); round.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = round; g.fillRect(L - 2, T - rim, Rr - L + 4, B - T + rim + 6);
  g.restore();
  // the mouth: the inside, then the lip where the glaze runs thin
  const cx = (L + Rr) / 2;
  const inside = g.createLinearGradient(L, T - rim, Rr, T + rim); inside.addColorStop(0, z.deep); inside.addColorStop(0.6, z.base); inside.addColorStop(1, z.rim);
  g.fillStyle = inside; g.beginPath(); g.ellipse(cx, T, (Rr - L) / 2, rim, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(cx - 6, T + 2, (Rr - L) / 2 - 12, rim - 4, 0, 0, TAU); g.fill();
  g.strokeStyle = z.rim; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, T, (Rr - L) / 2 - 1, rim, 0, 0, TAU); g.stroke();
  g.strokeStyle = `rgba(255,255,255,${0.25 + z.gloss * 0.3})`; g.lineWidth = 1.2; g.beginPath(); g.ellipse(cx, T - 0.5, (Rr - L) / 2 - 1, rim, 0, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
}
// #endregion glaze-mug

export class GlazeRadios extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BAR = { x: 13, y: 284, w: 334, h: 61, pad: 4 };
  static css = `
    input { opacity: 0; margin: 0; height: 53px; cursor: pointer; }
    label { height: 53px; text-align: center; font: 400 18px/53px ${NARROW}; letter-spacing: -0.02em; color: #fbe3d6; white-space: nowrap; }
    output { width: 320px; font: 500 12.5px/1.3 ${SANS}; color: #fde9df; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas?.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['label', 'data-note'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region glaze-radios
  build() {
    const list = this.list = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Glaze';
    const B = GlazeRadios.BAR, tw = this.tw = (B.w - B.pad * 2) / Math.max(1, list.length);
    this.radios = []; this.labels = [];
    list.forEach((o, i) => {
      const r = node(`<input type="radio" name="glaze" id="g${i}" value="${esc(o.value)}">`); r.style.width = `${tw}px`;
      const l = node(`<label for="g${i}">${esc(o.label)}</label>`); l.style.width = `${tw}px`;
      box.append(r, l); this.radios.push(r); this.labels.push(l);
    });
    this.note = node('<output aria-live="polite"></output>'); box.append(this.note);
    const at = Math.max(0, list.findIndex((o) => o.value === was), was ? -1 : list.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.pos = { x: at, v: 0 }; this.shown = at; this.from = at; this.wipe = 1; this.fade = 1;
    this.sync(false);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.sync(true); this.request(); }
  glaze(i) { return GLAZES[this.list[i]?.value] ?? GLAZES.celadon; }
  sync(animate) {
    const i = this.index;
    this.note.value = this.list[i]?.data.note ?? '';
    if (animate && i !== this.shown) {
      // the mug that shows now becomes the one underneath, and the new glaze is wiped over it
      if (this.wipe > 0.5) this.from = this.shown;
      this.shown = i; this.wipe = reduced() ? 1 : 0; this.fade = reduced() ? 1 : 0;
    }
    this.setValue(this.value);
  }

  draw(ctx, w, h) {
    const B = GlazeRadios.BAR, n = this.radios.length;
    let moving = spring(this.pos, this.index, this.dt, 260, 24);
    if (this.wipe < 1) { this.wipe = Math.min(1, this.wipe + this.dt / 0.55); moving = true; }
    if (this.fade < 1) { this.fade = Math.min(1, this.fade + this.dt / 0.4); moving = true; }
    const ground = ctx.createLinearGradient(0, 0, w, h); ground.addColorStop(0, '#f2470a'); ground.addColorStop(1, '#ea3c06');
    ctx.fillStyle = ground; ctx.fillRect(0, 0, w, h);
    // the shadow the mug throws to the right
    ctx.save(); ctx.filter = 'blur(5px)'; ctx.fillStyle = 'rgba(120,20,0,0.5)';
    ctx.beginPath(); ctx.ellipse(232, 205, 86, 21, -0.12, 0, TAU); ctx.fill(); ctx.restore();
    // the mug in the glaze before, then the new glaze over it from the right edge to the left
    const MX = 22, MY = 14, mug = (i) => cached(this, `mug${i}`, 300, 250, (g) => drawMug(g, this.glaze(i), 3));
    if (this.wipe < 1) ctx.drawImage(mug(this.from), MX, MY, 300, 250);
    const edge = lerp(MX + 300, MX, smooth(this.wipe));
    ctx.save(); ctx.beginPath(); ctx.rect(edge, 0, w - edge, h); ctx.clip();
    ctx.drawImage(mug(this.shown), MX, MY, 300, 250);
    ctx.restore();
    // the words for the glaze come in as it does
    ctx.save(); ctx.globalAlpha = smooth(this.fade); put(ctx, this.note, 31, 256); ctx.restore();
    // the bar, the thumb in the colour of the glaze, and the names
    ctx.fillStyle = '#c42f05'; rr(ctx, B.x, B.y, B.w, B.h, B.h / 2); ctx.fill();
    const x = this.pos.x, near = clamp(Math.round(x), 0, n - 1), tx = B.x + B.pad + x * this.tw, squash = clamp(Math.abs(this.pos.v) * 0.012, 0, 0.16);
    const tint = mix(this.glaze(this.from).thumb, this.glaze(this.shown).thumb, smooth(this.wipe));
    this.labels.forEach((l, i) => put(ctx, l, B.x + B.pad + i * this.tw, B.y + B.pad));
    ctx.save();
    rr(ctx, tx - this.tw * squash / 2, B.y + B.pad + 53 * squash / 2, this.tw * (1 + squash), 53 * (1 - squash), 27); ctx.clip();
    ctx.fillStyle = tint; ctx.fillRect(0, B.y, w, B.h);
    // the names again, dark or light to suit the thumb, seen only through it
    const dark = this.glaze(near).gloss > 0.6;
    ctx.filter = dark ? 'brightness(0) invert(1)' : 'brightness(0)'; ctx.globalAlpha = 0.86;
    this.labels.forEach((l, i) => put(ctx, l, B.x + B.pad + i * this.tw, B.y + B.pad));
    ctx.restore();
    // the radios are drawn last, with no alpha, so that a tap on a name answers the radio and not its label
    this.radios.forEach((r, i) => hit(ctx, r, B.x + B.pad + i * this.tw, B.y + B.pad));
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) focusRing(ctx, tx + 3, B.y + B.pad + 3, this.tw - 6, 47);
    return moving;
  }
  // #endregion glaze-radios
}
customElements.define('glaze-radios', GlazeRadios);

// ---------------------------------------------------------------------------------------------------------
// Crossword: one text input across a row of the grid
// ---------------------------------------------------------------------------------------------------------

function drawPaper(g) {
  // specks and blotches over the whole print, light on the black squares and dark on the paper
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd(i + 7) * 0.07})`; const s = 0.6 + rnd(i + 3) ** 2 * 2.6; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 360, s, s); }
  g.filter = 'blur(3px)';
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + rnd(i + 70) * 0.05})`; g.beginPath(); g.ellipse(rnd(i + 71) * 360, rnd(i + 72) * 360, 6 + rnd(i + 73) * 16, 4 + rnd(i + 74) * 10, rnd(i) * 3, 0, TAU); g.fill(); }
}

export class CrosswordEntry extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HEAD = 103;
  static css = `
    header { display: flex; gap: 12px; width: 360px; height: 97px; padding: 0 6px 0 4px; box-sizing: border-box; overflow: hidden; background: #efefec; color: #141414; }
    header b { flex: none; font: 900 92px/97px ${SLAB}; letter-spacing: -0.06em; }
    header div { flex: 1; min-width: 0; padding-top: 12px; }
    header small { display: block; font: 700 10px/1 ${SLAB}; letter-spacing: 0.14em; text-transform: uppercase; }
    header p { margin: 10px 0 0; font: 500 21px/1.18 ${SLAB}; letter-spacing: -0.01em; }
    table { width: 360px; border-collapse: separate; border-spacing: 0; background: #141414; table-layout: fixed; }
    td { position: relative; height: 51px; padding: 0; box-shadow: inset 0 0 0 1px #141414; background: #efefec; color: #141414; text-align: center; font: 900 39px/51px ${SLAB}; }
    td.block { background: #141414; }
    td.entry { background: #f542b9; }
    td sup { position: absolute; left: 3px; top: 3px; font: 700 8px/1 ${SLAB}; }
    input { width: 360px; height: 51px; padding: 0; border: 0; outline: 0; background: transparent; color: transparent; caret-color: transparent; font: 16px ${SANS}; cursor: text; }
    input::selection { background: transparent; color: transparent; }`;

  ready() {
    this.born = [];
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['clue', 'number', 'direction', 'data-numbers'] });
    const root = this.shadowRoot;
    root.addEventListener('input', (e) => { if (e.target !== this.input) return; this.typed(e); });
    root.addEventListener('compositionend', () => this.typed({}));
    // A tap puts the caret in the square that was tapped, or after the last letter.
    root.addEventListener('click', (e) => {
      if (e.target !== this.input || this.plain) return;
      const at = Math.min(this.letters.length, Math.floor(point(this, e).x / (360 / this.cols)));
      this.input.setSelectionRange(at, at); this.request();
    });
    root.addEventListener('selectionchange', () => this.request());
    document.addEventListener('selectionchange', () => { if (this.shadowRoot.activeElement === this.input) this.request(); });
    root.addEventListener('focusin', () => this.blink(true));
    root.addEventListener('focusout', () => this.blink(false));
  }

  // #region crossword-entry
  build() {
    const box = this.canvas ?? this.$('.plain'), rows = options(this), was = this.input?.value ?? this.getAttribute('value') ?? '';
    // Each <option> is a row: # is a black square, . an empty one, ? a square of the answer, a letter is given.
    this.cols = Math.max(1, ...rows.map((r) => r.label.length));
    this.row = Math.max(0, rows.findIndex((r) => r.label.includes('?')));
    this.first = Math.max(0, rows[this.row]?.label.indexOf('?') ?? 0);
    this.length = (rows[this.row]?.label.match(/\?/g) ?? []).length || this.cols;
    const number = this.getAttribute('number') ?? '', dir = this.getAttribute('direction') ?? 'Across', clue = this.getAttribute('clue') ?? '';
    this.header = node(`<header><b>${esc(number)}</b><div><small>${esc(dir)}</small><p>${esc(clue)} (${this.length})</p></div></header>`);
    this.table = node(`<table aria-label="Crossword grid">${rows.map((r) => { const nums = (r.data.numbers ?? '').split(/\s+/); return `<tr>${[...r.label.padEnd(this.cols, '#')].map((ch, c) => `<td class="${ch === '#' ? 'block' : ch === '?' ? 'entry' : ''}">${/\d/.test(nums[c] ?? '') ? `<sup>${esc(nums[c])}</sup>` : ''}${/[A-Za-z]/.test(ch) ? esc(ch.toUpperCase()) : ''}</td>`).join('')}</tr>`; }).join('')}</table>`);
    this.input = node(`<input type="text" maxlength="${this.length}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="${esc(`${number} ${dir}: ${clue}, ${this.length} letters`)}">`);
    this.input.value = was;
    box.replaceChildren(this.header, this.table, this.input);
    this.typed({});
  }
  get letters() { return this.input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, this.length); }
  get value() { return this.letters; }
  set value(v) { this.input.value = String(v); this.typed({}); }
  // Keep letters only, in capitals. While an IME is composing the field is left alone and only the drawing is cleaned.
  typed(e) {
    const text = this.letters, now = performance.now();
    if (!e.isComposing && this.input.value !== text) { const at = Math.min(text.length, this.input.selectionStart ?? text.length); this.input.value = text; try { this.input.setSelectionRange(at, at); } catch {} }
    for (let i = 0; i < this.length; i++) { if (text[i] !== this.was?.[i]) this.born[i] = text[i] ? now : 0; }
    this.was = text;
    this.setValue(text);
    const short = text.length > 0 && text.length < this.length;
    try { this.internals?.setValidity(short ? { tooShort: true } : {}, short ? `${this.length} letters are needed` : '', this.input); } catch {}
    this.caretOn = true; this.request();
  }
  // The field's own caret is transparent, or its blink would raise two paints a second for a picture that isn't drawn.
  blink(on) {
    clearInterval(this.timer); this.caretOn = on;
    if (on && !reduced()) this.timer = setInterval(() => { this.caretOn = !this.caretOn; this.request(); }, 530);
    this.request();
  }

  draw(ctx, w, h, now) {
    const H = CrosswordEntry.HEAD, cw = w / this.cols, ch = this.table.offsetHeight / Math.max(1, this.table.rows.length), y0 = H + this.row * ch;
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.header, 0, 0);
    put(ctx, this.table, 0, H);
    hit(ctx, this.input, 0, y0, w, ch);
    // the letters of the answer, each stamped into its square when it is typed
    const text = this.letters, focused = this.shadowRoot.activeElement === this.input;
    let moving = false;
    ctx.fillStyle = '#141414'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `900 39px ${SLAB}`;
    for (let i = 0; i < text.length; i++) {
      const age = reduced() ? 1 : clamp((now - (this.born[i] || 0)) / 150), x = (this.first + i + 0.5) * cw, y = y0 + ch / 2;
      if (age < 1) moving = true;
      ctx.save(); ctx.translate(x, y); ctx.rotate((rnd(i * 7 + text.charCodeAt(i)) - 0.5) * 0.07); ctx.scale(lerp(1.45, 1, easeOut(age)), lerp(1.45, 1, easeOut(age)));
      ctx.globalAlpha = clamp(age * 2); ctx.fillText(text[i], 0, 14); ctx.restore();
    }
    if (focused) {
      const a = this.input.selectionStart ?? text.length, b = this.input.selectionEnd ?? a;
      if (b > a) { ctx.fillStyle = 'rgba(20,20,20,0.22)'; ctx.fillRect((this.first + a) * cw, y0 + 1, (b - a) * cw, ch - 2); }
      else if (a < this.length && this.caretOn) { ctx.fillStyle = '#141414'; ctx.fillRect((this.first + a + 0.5) * cw - 0.8, y0 + 13, 1.6, ch - 26); }
      if (this.input.matches(':focus-visible') && text.length === this.length) { ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.strokeRect(this.first * cw + 3, y0 + 3, this.length * cw - 6, ch - 6); }
    }
    ctx.drawImage(cached(this, 'paper', 360, 360, drawPaper), 0, 0, w, h);
    return moving;
  }
  // #endregion crossword-entry
}
customElements.define('crossword-entry', CrosswordEntry);

// ---------------------------------------------------------------------------------------------------------
// Tulips: a scroll-snap scroller, with a radio for each slide
// ---------------------------------------------------------------------------------------------------------

// A tulip in a glass, 130 by 330 units. `shape` is "lily" for pointed petals that flare, else a cup.
function drawTulip(g, o) {
  const petal = o.petal ?? '#e2231a', dark = o.dark ?? '#9c0f0f', lily = o.shape === 'lily';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const vx = 44, vw = 36, vt = 212, vb = 318, water = 284;
  // the far wall of the glass and the water
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(vx, vt, vw, vb - vt);
  g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(vx + 1, water, vw - 2, vb - water);
  // stem and leaf
  const stem = new Path2D(); stem.moveTo(vx + vw * 0.56, vb - 6); stem.bezierCurveTo(vx + vw * 0.5, 240, 70, 150, 66, 74);
  g.strokeStyle = '#3d7a23'; g.lineWidth = 4.4; g.stroke(stem);
  g.strokeStyle = '#7fb944'; g.lineWidth = 1.5; g.save(); g.translate(-1, 0); g.stroke(stem); g.restore();
  const leaf = g.createLinearGradient(20, 100, 66, 210); leaf.addColorStop(0, '#a9c98a'); leaf.addColorStop(0.5, '#5c9a3a'); leaf.addColorStop(1, '#2f6a1f');
  g.fillStyle = leaf; g.beginPath(); g.moveTo(63, 214); g.bezierCurveTo(52, 170, 34, 140, 10, 112); g.bezierCurveTo(40, 118, 62, 150, 67, 200); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(62, 204); g.bezierCurveTo(52, 166, 36, 138, 14, 114); g.stroke();
  // the flower: two petals behind and one in front
  const cx = 66, cy = 74, hgt = lily ? 62 : 54, wid = lily ? 20 : 23;
  const one = (dx, lean, shade, tip) => {
    const grad = g.createLinearGradient(cx + dx - wid, cy - hgt, cx + dx + wid, cy); grad.addColorStop(0, shade ? dark : petal); grad.addColorStop(0.55, petal); grad.addColorStop(1, dark);
    g.fillStyle = grad; g.beginPath(); g.moveTo(cx, cy);
    g.bezierCurveTo(cx + dx - wid, cy - hgt * 0.25, cx + dx - wid * (lily ? 0.5 : 0.95), cy - hgt * 0.8, cx + dx + lean, cy - hgt * tip);
    g.bezierCurveTo(cx + dx + wid * (lily ? 0.5 : 0.95), cy - hgt * 0.8, cx + dx + wid, cy - hgt * 0.25, cx, cy); g.fill();
  };
  one(-wid * 0.62, lily ? -15 : -3, true, lily ? 1.02 : 0.96); one(wid * 0.62, lily ? 15 : 3, true, lily ? 1.02 : 0.96); one(0, 0, false, lily ? 0.92 : 1);
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx - 5, cy - 8); g.quadraticCurveTo(cx - 9, cy - hgt * 0.55, cx - 3, cy - hgt * 0.84); g.stroke();
  // the near wall of the glass: edges, the surface of the water, the thick base and a long highlight
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(vx, vt); g.lineTo(vx, vb - 2); g.moveTo(vx + vw, vt); g.lineTo(vx + vw, vb - 2); g.stroke();
  g.beginPath(); g.ellipse(vx + vw / 2, vt, vw / 2, 3, 0, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(vx + vw / 2, water, vw / 2 - 1, 2.4, 0, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(vx + vw / 2, vb - 2, vw / 2, 3.4, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.26)'; g.fillRect(vx + 5, vt + 8, 2.6, vb - vt - 20);
  g.save(); g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(vx + vw / 2 + 16, vb + 2, 34, 3.5, 0, 0, TAU); g.fill(); g.restore();
}

export class TulipCarousel extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    .track { display: flex; width: 360px; height: 360px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; outline: 0; }
    .track.held { scroll-snap-type: none; cursor: grabbing; }
    article { position: relative; flex: none; width: 360px; height: 360px; overflow: hidden; scroll-snap-align: start; scroll-snap-stop: always; color: #fff; }
    h3 { position: absolute; left: 16px; top: 98px; margin: 0; font: 400 74px/1 ${DISPLAY}; letter-spacing: -0.045em; white-space: nowrap; }
    p { position: absolute; left: 17px; top: 186px; margin: 0; font: 500 11px/1 ${SANS}; }
    p span { margin-left: 8px; opacity: 0.75; }
    input { opacity: 0; width: 66px; height: 32px; margin: 0; cursor: pointer; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['label', 'data-kind', 'data-height', 'data-ground', 'data-petal', 'data-dark', 'data-shape'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.go(this.radios.indexOf(e.target)); this.commit(); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region tulip-carousel
  build() {
    const list = this.list = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren(); this.pictures?.clear();
    const track = this.track = node(`<div class="track" tabindex="0" role="region" aria-roledescription="carousel" aria-label="${esc(this.getAttribute('label') ?? 'Tulip varieties')}">${list.map((o, i) => `<article aria-label="${i + 1} of ${list.length}" style="background:${esc(o.data.ground ?? '#e8540c')}"><h3>${esc(o.label)}</h3><p>${esc(o.data.kind ?? '')}<span>${esc(o.data.height ?? '')}</span></p></article>`).join('')}</div>`);
    box.append(track);
    this.radios = list.map((o) => { const r = node(`<input type="radio" name="slide" value="${esc(o.value)}" aria-label="${esc(o.label)}">`); box.append(r); return r; });
    const at = Math.max(0, list.findIndex((o) => o.value === was), was ? -1 : list.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    track.scrollLeft = at * 360;
    this.heading = -1;
    // The scroller scrolls by itself: touch, wheel and arrow keys. The radios follow where it comes to rest.
    track.addEventListener('scroll', () => {
      this.request();
      const near = clamp(Math.round(track.scrollLeft / 360), 0, list.length - 1);
      if (this.heading >= 0) { if (near === this.heading) this.heading = -1; return; }
      if (near !== this.index && !this.held) { this.radios[near].checked = true; this.commit(); }
    });
    track.addEventListener('scrollend', () => { this.heading = -1; });
    // A mouse has no drag to scroll, so the control adds one. Snapping is off while the button is down.
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button || this.plain) return;
      const x0 = e.clientX, s0 = track.scrollLeft, k = 360 / this.canvas.getBoundingClientRect().width;
      const move = (m) => { if (!this.held && Math.abs(m.clientX - x0) > 3) { this.held = true; track.classList.add('held'); } if (this.held) track.scrollLeft = s0 - (m.clientX - x0) * k; };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!this.held) return;
        const dx = track.scrollLeft - s0, near = clamp(Math.round((s0 + dx + Math.sign(dx) * 110) / 360), 0, list.length - 1);
        this.held = false;
        this.radios[near].checked = true; this.commit();
        track.scrollTo({ left: near * 360, behavior: reduced() ? 'auto' : 'smooth' });
        const done = () => { track.classList.remove('held'); track.removeEventListener('scrollend', done); clearTimeout(timer); };
        const timer = setTimeout(done, 700); track.addEventListener('scrollend', done);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
    this.setValue(this.value);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { const i = this.radios.findIndex((r) => r.value === String(v)); if (i < 0) return; this.radios[i].checked = true; this.go(i); this.setValue(this.value); }
  // Scroll to a slide. Until the scroller arrives, the slides it passes do not check their radios.
  go(i) {
    if (Math.round(this.track.scrollLeft) === i * 360) return;
    this.heading = i;
    this.track.scrollTo({ left: i * 360, behavior: reduced() || this.plain ? 'auto' : 'smooth' });
    this.request();
  }
  commit() { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); }

  draw(ctx, w, h) {
    const sl = this.track.scrollLeft, n = this.list.length;
    put(ctx, this.track, 0, 0);
    // a tulip for each slide near the view. It moves a little faster than its slide.
    this.list.forEach((o, i) => {
      const x = i * 360 - sl;
      if (Math.abs(x) > 420) return;
      ctx.drawImage(cached(this, `tulip${i}`, 130, 330, (g) => drawTulip(g, o.data)), 226 + x * 1.16, 18, 130, 330);
    });
    // the markers: a line for each slide and a bright one that follows the scroll position
    const bw = (w - 34 - (n - 1) * 4) / Math.max(1, n), y = 338;
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    this.radios.forEach((r, i) => { hit(ctx, r, 17 + i * (bw + 4) - 2, y - 16, bw + 4, 32); ctx.fillRect(17 + i * (bw + 4), y, bw, 1.5); });
    ctx.fillStyle = '#fff'; ctx.fillRect(17 + clamp(sl / 360, 0, n - 1) * (bw + 4), y - 0.3, bw, 2.1);
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) focusRing(ctx, 17 + this.radios.indexOf(f) * (bw + 4) - 2, y - 9, bw + 4, 18);
    if (f === this.track && f.matches(':focus-visible')) focusRing(ctx, 4, 4, w - 8, h - 8);
    return false;
  }
  // #endregion tulip-carousel
}
customElements.define('tulip-carousel', TulipCarousel);
