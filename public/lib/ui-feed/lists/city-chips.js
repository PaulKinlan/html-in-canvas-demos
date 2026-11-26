// <city-chips>: checkboxes, chip buttons and a filter field printed in two colours that slip on change.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, easeOut, spring, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const GROT = "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const hide = 'position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;';

const BLUE = '#2537c9', PINK = '#f14aa4', CREAM = '#f3ead8', YELLOW = '#ffc21a';
function drawHalftone(g) {
  g.fillStyle = PINK; g.fillRect(0, 0, 360, 360);
  g.fillStyle = 'rgba(120,0,60,0.16)';
  for (let y = 0; y < 360; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 360; x += 4) { g.beginPath(); g.arc(x, y, 0.75, 0, TAU); g.fill(); }
}

export class CityChips extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOX = { x: 14, y: 58, w: 332, h: 50 };
  static LIST = { x: 14, y: 122, w: 332 };
  static css = `
    header { width: 332px; height: 44px; }
    h2 { position: absolute; left: 0; top: 2px; margin: 0; font: 800 34px/1 ${GROT}; letter-spacing: -0.03em; color: ${BLUE}; }
    header output { position: absolute; right: 0; bottom: 6px; font: 700 12px/1 ${MONO}; color: ${BLUE}; }
    .box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 332px; min-height: 50px; padding: 8px 10px; box-sizing: border-box; }
    .box button { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 10px; border: 0; background: ${BLUE}; color: #fff; font: 600 15px/1 ${GROT}; cursor: pointer; }
    .box button span { display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: ${PINK}; color: ${BLUE}; font: 900 11px/1 ${SANS}; }
    .box button:focus-visible { outline: 2px dashed ${BLUE}; outline-offset: 2px; }
    .box input { flex: 1; min-width: 60px; height: 30px; padding: 0 4px; border: 0; outline: 0; background: transparent; color: ${BLUE}; font: 600 15px/30px ${GROT}; caret-color: ${PINK}; }
    .yellow button { background: ${YELLOW}; color: transparent; }
    .yellow button span, .yellow input { visibility: hidden; }
    .list { width: 332px; padding: 6px 0; }
    .list label { display: flex; align-items: center; gap: 14px; position: relative; height: 20px; padding: 0 14px; font: 500 14px/20px ${GROT}; color: ${BLUE}; cursor: pointer; }
    .list label[hidden] { display: none; }
    .list label small { width: 14px; font: 700 8.5px/1 ${MONO}; opacity: 0.75; }
    .list label input { ${hide} }
    .list label:has(:checked)::after { content: ''; position: absolute; right: 16px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: ${PINK}; }
    .list label:has(:focus-visible) { outline: 2px dashed ${BLUE}; outline-offset: -2px; }`;

  ready() {
    this.reg = { x: { x: -3, v: 0 }, y: { x: 0, v: 0 } };
    this.bar = { x: 0, v: 0 }; this.active = -1; this.openT = 0;
    this.build();
    this.addEventListener('feed-plain', () => { this.plate.hidden = true; });
    const root = this.shadowRoot;
    root.addEventListener('focusin', () => this.request());
    root.addEventListener('focusout', () => setTimeout(() => this.request(), 0));
    root.addEventListener('pointermove', (e) => { const l = e.target.closest?.('.list label'); const i = l ? this.labels.indexOf(l) : -1; if (i >= 0 && i !== this.active) { this.active = i; this.request(); } });
  }

  // #region city-chips
  build() {
    const cities = this.cities = options(this), box = this.canvas ?? this.$('.plain'), label = esc(this.getAttribute('label') ?? 'Cities');
    this.header = node(`<header><h2 id="cc-label">${label}</h2><output></output></header>`);
    this.box = node('<div class="box" role="group" aria-labelledby="cc-label"><input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cc-list" autocomplete="off" spellcheck="false" aria-label="Add a city"></div>');
    // The yellow plate: a copy of the row of buttons with only the yellow ink. It is inert and hidden.
    this.plate = node('<div class="box yellow" inert aria-hidden="true"></div>');
    this.list = node(`<div class="list" id="cc-list" role="group" aria-labelledby="cc-label">${cities.map((o, i) => `<label id="cc-${i}"><input type="checkbox" value="${esc(o.value)}"${o.selected ? ' checked' : ''}><small>${String(i + 1).padStart(2, '0')}</small><span>${esc(o.label)}</span></label>`).join('')}</div>`);
    box.replaceChildren(this.header, this.plate, this.box, this.list);
    this.q = this.box.querySelector('input');
    this.boxes = [...this.list.querySelectorAll('input')]; this.labels = this.boxes.map((b) => b.parentElement);
    this.order = this.boxes.filter((b) => b.checked);     // the buttons keep the order the cities were chosen in
    this.list.addEventListener('change', (e) => this.toggled(e.target));
    this.box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.uncheck(this.boxes.find((x) => x.value === b.value), true); });
    this.q.addEventListener('input', () => { this.filter(); this.active = this.visible[0] ?? -1; this.request(); });
    this.q.addEventListener('keydown', (e) => this.key(e));
    this.box.addEventListener('keydown', (e) => { if (e.target.localName === 'button' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.uncheck(this.boxes.find((x) => x.value === e.target.value), true); } });
    this.sync(false);
  }
  get visible() { return this.labels.map((l, i) => (l.hidden ? -1 : i)).filter((i) => i >= 0); }
  filter() {
    const q = this.q.value.trim().toLowerCase();
    this.labels.forEach((l, i) => { l.hidden = !!q && !this.cities[i].label.toLowerCase().includes(q); });
  }
  key(e) {
    const vis = this.visible, at = vis.indexOf(this.active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.active = vis[clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, vis.length - 1)] ?? -1; }
    if (e.key === 'Enter' && this.active >= 0 && vis.includes(this.active)) { e.preventDefault(); const b = this.boxes[this.active]; b.checked = !b.checked; this.toggled(b); this.q.value = ''; this.filter(); }
    if (e.key === 'Backspace' && !this.q.value && this.order.length) { e.preventDefault(); this.uncheck(this.order.at(-1)); }
    if (e.key === 'Escape') { this.q.value = ''; this.filter(); }
    this.q.setAttribute('aria-activedescendant', this.active >= 0 ? `cc-${this.active}` : '');
    this.request();
  }
  toggled(b) { this.order = b.checked ? [...this.order.filter((x) => x !== b), b] : this.order.filter((x) => x !== b); this.sync(); }
  uncheck(b, refocus) { if (!b) return; b.checked = false; this.toggled(b); if (refocus) this.q.focus({ preventScroll: true }); }
  get value() { return this.order.map((b) => b.value); }
  // A change to the set is a new pass through the press: the yellow plate lands a little off and settles.
  sync(kick = true) {
    const chips = this.order.map((b) => { const o = this.cities[this.boxes.indexOf(b)]; return `<button type="button" value="${esc(o.value)}" aria-label="Remove ${esc(o.label)}">${esc(o.label)}<span aria-hidden="true">×</span></button>`; }).join('');
    for (const old of this.box.querySelectorAll('button')) old.remove();
    this.q.insertAdjacentHTML('beforebegin', chips);
    this.plate.innerHTML = chips;
    this.header.querySelector('output').textContent = `${String(this.order.length).padStart(2, '0')}/${String(this.boxes.length).padStart(2, '0')}`;
    const data = new FormData(), name = this.getAttribute('name') || 'city';
    for (const v of this.value) data.append(name, v);
    this.setValue(data);
    if (kick && !reduced()) { this.reg.x.v = -90 + rnd(this.order.length) * 40; this.reg.y.v = 60 * (rnd(this.order.length + 3) - 0.5); }
    this.dispatchEvent(new Event(kick ? 'change' : 'ready', { bubbles: kick }));
    this.request();
  }

  draw(ctx, w, h) {
    const B = CityChips.BOX, L = CityChips.LIST;
    let moving = false;
    ctx.drawImage(cached(this, 'halftone', 360, 360, drawHalftone), 0, 0, w, h);
    moving = spring(this.reg.x, -3, this.dt, 120, 9) || moving; moving = spring(this.reg.y, 0, this.dt, 120, 9) || moving;
    // the heading in blue, over the same heading in red a little off
    ctx.save(); ctx.globalAlpha = 0.85; ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ff2a2a'; ctx.font = `800 34px ${GROT}`; ctx.save(); ctx.letterSpacing = '-0.03em'; ctx.fillText(this.header.querySelector('h2').textContent, B.x + 2.5, 14 + 2 + 29); ctx.restore();
    ctx.restore();
    put(ctx, this.header, B.x, 14);
    // the field: cream paper with a blue rule, the yellow plate, then the blue plate over it
    const bh = Math.max(B.h, this.box.offsetHeight);
    ctx.fillStyle = CREAM; ctx.fillRect(B.x, B.y, B.w, bh);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; put(ctx, this.plate, B.x + this.reg.x.x, B.y + this.reg.y.x); ctx.restore();
    put(ctx, this.box, B.x, B.y);
    ctx.strokeStyle = BLUE; ctx.lineWidth = 2.5; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, bh - 2);
    // The list shows while the control has focus. A yellow bar runs to the row the keys or the pointer are on.
    const inside = !!this.shadowRoot.activeElement, want = inside ? 1 : 0;
    if (this.q.getAttribute('aria-expanded') !== String(inside)) this.q.setAttribute('aria-expanded', String(inside));
    if (this.openT !== want) { this.openT = reduced() ? want : clamp(this.openT + (want ? 1 : -1) * this.dt / 0.2); moving = true; }
    const LY = B.y + bh + 14, e = easeOut(this.openT);
    if (e > 0) {
      const lh = this.list.offsetHeight * e;
      // a shadow of dots, then the paper, then the rows
      ctx.fillStyle = 'rgba(37,55,201,0.55)';
      for (let y = LY + 5; y < LY + lh + 5; y += 3) for (let x = L.x + 5 + ((y / 3) % 2 ? 1.5 : 0); x < L.x + L.w + 5; x += 3) if (x > L.x + L.w - 1 || y > LY + lh - 1) ctx.fillRect(x, y, 1.2, 1.2);
      ctx.fillStyle = CREAM; ctx.fillRect(L.x, LY, L.w, lh);
      ctx.save(); ctx.beginPath(); ctx.rect(L.x, LY, L.w, lh); ctx.clip();
      const row = this.labels[this.active];
      if (row && !row.hidden) {
        moving = spring(this.bar, row.offsetTop, this.dt, 320, 28) || moving;
        ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = YELLOW; ctx.fillRect(L.x + 4 + this.reg.x.x + 3, LY + this.bar.x, L.w - 8, 20); ctx.restore();
      }
      put(ctx, this.list, L.x, LY);
      ctx.restore();
    } else hit(ctx, this.list, L.x, -400);
    return moving;
  }
  // #endregion city-chips
}
customElements.define('city-chips', CityChips);
