// ui-feed/dots.js: controls shown on dot and tube displays. Each is a rebuild, in HTML-in-canvas, of a demo
// on https://ui-feed.dev/ (the page that uses them links to each original).
//
//   <led-listbox name="showing">          a single-choice list on an LED board. Options are <option> children:
//     <option value="1920" data-time="7:20" data-meta="Screen 2  1h47" data-note="Last 6">Glass Orchard</option>
//   </led-listbox>
//
// The lists are real radio inputs inside the canvas. The board is a picture of them, reduced to one pixel
// a dot and enlarged through a dot mask (dotBoard() in kit.js).

import { FeedControl, put, hit, dotBoard, options, esc, clamp, lerp, rr, TAU, reduced } from './kit.js';

// #region led-listbox
export class LedListbox extends FeedControl {
  static size = [360, 380];
  static html = `<div class="list" role="radiogroup"></div>`;
  static css = `
    .list { width: 344px; padding: 0; color: #d9dde6; font: 700 20px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; text-transform: uppercase; }
    label { display: grid; grid-template-columns: 92px 1fr; grid-template-rows: 30px 26px; column-gap: 8px; height: 68px; padding: 6px 4px; box-sizing: border-box; border-bottom: 4px solid #3a3f4a; position: relative; }
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; }
    .t { grid-row: 1 / 3; font: 700 44px/56px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; letter-spacing: -1px; }
    .n { font-size: 22px; line-height: 28px; white-space: nowrap; overflow: hidden; }
    .m { font-size: 16px; line-height: 24px; display: flex; justify-content: space-between; color: #9aa1af; }
    .m b { color: inherit; }
    label:has(:checked) { background: #c9ced8; color: #111; }
    label:has(:checked) .m { color: #333; }
    label:has(:disabled) { color: #4a4f5a; }
    label:has(:disabled) .m { color: #4a4f5a; }
    label:has(:disabled) .m b { color: #ff4a3d; }
    label:has(:focus-visible) { box-shadow: inset 0 0 0 4px #ffd24a; }`;

  ready() {
    this.list = this.$('.list');
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.list.addEventListener('change', () => {
      this.setValue(this.value);
      this.flash = performance.now();
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  get value() { return this.list.querySelector(':checked')?.value ?? ''; }
  set value(v) { const r = this.$$('input').find((i) => i.value === String(v)); if (r) { r.checked = true; this.setValue(this.value); this.request(); } }
  sync() {
    const keep = this.list.querySelector(':checked')?.value;
    this.list.innerHTML = options(this).map((o) => `<label><input type="radio" name="o" value="${esc(o.value)}"${o.disabled ? ' disabled' : ''}${(keep ?? (o.selected ? o.value : null)) === o.value ? ' checked' : ''}>
      <span class="t">${esc(o.data.time ?? '')}</span><span class="n">${esc(o.label)}</span><span class="m"><span>${esc(o.data.meta ?? '')}</span><b>${esc(o.data.note ?? '')}</b></span></label>`).join('');
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, w, h);
    const b = dotBoard(this, ctx, { x: 8, y: 8, w: w - 16, h: h - 16, cell: 2.2, bg: '#0a0b0e', off: 0.06, glow: 1.6 }, (c) => put(c, this.list, 0, 4));
    this.board = b;
    hit(ctx, this.list, b.ox, b.oy + 4);
    // a short refresh sweep after a choice, the way a board redraws line by line
    const age = (now - (this.flash ?? -1e9)) / 420;
    if (age < 1 && !reduced()) {
      ctx.fillStyle = `rgba(255,255,255,${0.22 * (1 - age)})`;
      ctx.fillRect(8, 8 + (h - 16) * age - 6, w - 16, 6);
      return true;
    }
    return false;
  }
}
customElements.define('led-listbox', LedListbox);
// #endregion led-listbox

// Scan lines, a slow bright band and dark corners over a rectangle: the glass of a tube.
function tube(ctx, x, y, w, h, now, { lines = 0.22, band = true } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${lines})`;
  for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy + 2, w, 1);
  if (band && !reduced()) {
    const by = y + ((now / 30) % (h + 160)) - 80;
    const g = ctx.createLinearGradient(0, by, 0, by + 80);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, by, w, 80);
  }
  const v = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

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

// #region led-counter
//   <led-counter name="message" maxlength="40" value="Running late"></led-counter>
// A real <textarea> typed into through the board, and a <meter> that the canvas draws as lamp segments.
export class LedCounter extends FeedControl {
  static size = [360, 360];
  static html = `<textarea rows="3" aria-label="Message" spellcheck="false" autocapitalize="off"></textarea><output class="count"></output><meter min="0" aria-label="Characters used"></meter><div class="mirror" aria-hidden="true"></div>`;
  static css = `
    textarea { width: 340px; height: 124px; padding: 6px 4px; border: 0; outline: 0; resize: none; overflow: hidden; background: transparent; color: #ffb21e; caret-color: #ffb21e; font: 700 27px/38px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }
    textarea::selection { background: #ffb21e; color: #140b02; }
    .count { width: 340px; height: 44px; text-align: right; color: #ffb21e; font: 700 40px/44px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }
    .count.near { color: #ff4a2a; }
    meter { width: 10px; height: 10px; opacity: 0; }
    .mirror { width: 340px; padding: 6px 4px; visibility: hidden; white-space: pre-wrap; overflow-wrap: break-word; font: 700 27px/38px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }`;

  ready() {
    this.area = this.$('textarea'); this.count = this.$('.count'); this.meter = this.$('meter');
    const max = +this.getAttribute('maxlength') || 40;
    this.area.maxLength = max; this.meter.max = max;
    this.area.value = this.getAttribute('value') ?? '';
    this.level = { x: this.area.value.length };
    this.area.addEventListener('input', () => { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    for (const type of ['input', 'keyup', 'pointerup', 'focus', 'select']) this.area.addEventListener(type, () => this.caret());
    this.sync();
  }
  get value() { return this.area.value; }
  set value(v) { this.area.value = v; this.sync(); }
  // The caret is not in the textarea's picture, so the board gets a block cursor. Its place is measured
  // with a hidden copy of the text up to the caret, laid out with the same font and width.
  caret() {
    const m = this.$('.mirror'), mark = document.createElement('span');
    mark.textContent = '\u200b';
    m.textContent = this.area.value.slice(0, this.area.selectionEnd);
    m.append(mark);
    this.cursor = { x: mark.offsetLeft, y: mark.offsetTop };
    this.request();
  }
  sync() {
    const n = this.area.value.length, max = this.area.maxLength;
    this.meter.value = n;
    this.count.textContent = `${n}/${max}`;
    this.count.classList.toggle('near', n >= max * 0.9);
    this.setValue(this.area.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#0d0803';
    ctx.fillRect(0, 0, w, h);
    const typing = this.shadowRoot.activeElement === this.area && this.area.selectionStart === this.area.selectionEnd && this.cursor;
    const b = dotBoard(this, ctx, { x: 8, y: 8, w: w - 16, h: 200, cell: 2.5, bg: '#120a03', off: 0.05, glow: 2 }, (c) => {
      put(c, this.area, 0, 0);
      if (typing && (reduced() || Math.floor(now / 500) % 2 === 0)) { c.fillStyle = '#ffb21e'; c.fillRect(this.cursor.x + 1, this.cursor.y + 5, 14, 30); }
      put(c, this.count, 0, 148);
    });
    hit(ctx, this.area, b.ox, b.oy);
    ctx.fillStyle = '#b9a98a';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('CHARACTERS', 14, 190);
    // the meter, drawn from its value: one lamp for each character
    const max = this.meter.max, n = this.meter.value;
    const moving = Math.abs(this.level.x - n) > 0.05;
    this.level.x = reduced() ? n : lerp(this.level.x, n, 1 - Math.exp(-this.dt * 18));
    const x0 = 14, x1 = w - 14, y0 = 226, y1 = 326, pitch = (x1 - x0) / max;
    for (let i = 0; i < max; i++) {
      const lit = clamp(this.level.x - i), hot = i >= max * 0.9;
      ctx.fillStyle = hot ? '#3a120b' : '#3a2708';
      ctx.fillRect(x0 + i * pitch, y0, pitch * 0.62, y1 - y0);
      if (lit > 0) {
        ctx.globalAlpha = lit;
        ctx.shadowColor = hot ? '#ff4a2a' : '#ffa51e'; ctx.shadowBlur = 10;
        ctx.fillStyle = hot ? '#ff5a3a' : '#ffbd3a';
        ctx.fillRect(x0 + i * pitch, y0, pitch * 0.62, y1 - y0);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = '#8a7c63';
    ctx.letterSpacing = '0px';
    ctx.font = '11px ui-monospace, monospace';
    for (let v = 0; v <= max; v += 10) { ctx.textAlign = v === 0 ? 'left' : v === max ? 'right' : 'center'; ctx.fillText(String(v), x0 + v * pitch, y1 + 18); }
    ctx.textAlign = 'left';
    return moving || (typing && !reduced());
  }
}
customElements.define('led-counter', LedCounter);
// #endregion led-counter

// #region flipdot-rating
//   <flipdot-rating name="stars" value="3"></flipdot-rating>
// Five radio inputs. The canvas puts each one's hit region over a star and draws the stars as flip dots:
// a disc for each cell that turns over when its state changes.
const STAR = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.7 : 6.6, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const inside = (x, y, k) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = pts[i].map((v) => v * k), [xj, yj] = pts[j].map((v) => v * k); if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const full = [], ring = [];
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) { const a = inside(x - 6, y - 5.6, 1), b = inside(x - 6, y - 5.6, 0.52); full.push(a); ring.push(a && !b); }
  return { full, ring };
})();
const FONT = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', '/': '001001010100100' };

export class FlipdotRating extends FeedControl {
  static size = [360, 220];
  static html = [1, 2, 3, 4, 5].map((n) => `<input type="radio" name="r" value="${n}" aria-label="${n} of 5 stars">`).join('');
  static css = `input { width: 66px; height: 70px; opacity: 0; touch-action: manipulation; }`;
  static COLS = 72; static ROWS = 40;

  ready() {
    this.radios = this.$$('input');
    const C = FlipdotRating;
    this.phase = new Float32Array(C.COLS * C.ROWS);
    this.wait = new Float32Array(C.COLS * C.ROWS);
    this.target = new Uint8Array(C.COLS * C.ROWS);
    const v = +this.getAttribute('value');
    if (v) this.radios[v - 1].checked = true;
    this.shadowRoot.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.setValue(this.value);
    this.first = true;
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  set value(v) { this.radios.forEach((r) => { r.checked = r.value === String(v); }); this.setValue(this.value); this.request(); }
  layout() {
    const C = FlipdotRating, v = +this.value || 0, t = new Uint8Array(C.COLS * C.ROWS);
    for (let s = 0; s < 5; s++) {
      const shape = s < v ? STAR.full : STAR.ring;
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (shape[y * 13 + x]) t[(y + 5) * C.COLS + 2 + s * 14 + x] = 1;
    }
    const text = `${v}/5`;
    let cx = Math.round(C.COLS / 2 - (text.length * 8 - 2) / 2);
    for (const ch of text) {
      const g = FONT[ch];
      for (let i = 0; i < 15; i++) if (g[i] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) t[(24 + Math.floor(i / 3) * 2 + a) * C.COLS + cx + (i % 3) * 2 + b] = 1;
      cx += 8;
    }
    return t;
  }
  draw(ctx, w, h) {
    const C = FlipdotRating, g = (w - 16) / C.COLS, x0 = 8, y0 = (h - C.ROWS * g) / 2;
    const t = this.layout();
    for (let i = 0; i < t.length; i++) if (t[i] !== this.target[i]) { this.target[i] = t[i]; this.wait[i] = this.first || reduced() ? 0 : (i % C.COLS) * 0.006 + Math.random() * 0.05; }
    if (this.first) { this.phase.set(t); this.first = false; }
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    let moving = false;
    for (let y = 0; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
      const i = y * C.COLS + x;
      let p = this.phase[i];
      if (p !== this.target[i]) {
        moving = true;
        if (this.wait[i] > 0) this.wait[i] -= this.dt;
        else p = this.phase[i] = this.target[i] ? Math.min(1, p + this.dt * 7) : Math.max(0, p - this.dt * 7);
      }
      const cx = x0 + (x + 0.5) * g, cy = y0 + (y + 0.5) * g, sy = Math.abs(Math.cos(p * Math.PI));
      ctx.fillStyle = p > 0.5 ? '#e6e04a' : '#1e1e1e';
      ctx.beginPath();
      ctx.ellipse(cx, cy, g * 0.42, Math.max(0.3, g * 0.42 * sy), 0, 0, TAU);
      ctx.fill();
    }
    this.radios.forEach((r, s) => {
      const x = x0 + (1.5 + s * 14) * g, y = y0 + 4 * g;
      hit(ctx, r, x, y, 14 * g, 15 * g);
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; rr(ctx, x, y, 14 * g, 15 * g, 6); ctx.stroke(); }
    });
    return moving;
  }
}
customElements.define('flipdot-rating', FlipdotRating);
// #endregion flipdot-rating

// #region vcr-timer
//   <vcr-timer name="rec" date="2026-11-28" start="20:30" stop="22:05" channel="3"></vcr-timer>
// A form with <input type="date">, two <input type="time"> and an <input type="number">, drawn as the
// on-screen display of a video recorder. The fields are edited where they are drawn.
export class VcrTimer extends FeedControl {
  static size = [360, 330];
  static fps = 20;
  static html = `<div class="osd">
      <div class="row"><span>TIMER REC</span><span>PROG 1</span></div>
      <label class="row"><span>DATE</span><input type="date" name="date"></label>
      <label class="row big"><span>START</span><input type="time" name="start"></label>
      <label class="row big"><span>STOP</span><input type="time" name="stop"></label>
      <label class="row"><span>CH</span><input type="number" name="channel" min="1" max="99"><span class="sp">SPEED SP</span></label>
    </div>`;
  static css = `
    .osd { width: 340px; height: 310px; padding: 10px 12px; display: grid; align-content: space-between; color: #fff; font: 700 27px/1.15 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; text-shadow: 3px 3px 0 #0009; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .row.big input { font-size: 44px; }
    .sp { margin-left: auto; }
    input { font: inherit; color: inherit; background: none; border: 0; outline: 0; padding: 0; margin: 0; text-shadow: inherit; color-scheme: dark; }
    input:focus-visible { background: #ffffff38; }
    input::-webkit-calendar-picker-indicator { display: none; }
    input[type=number] { width: 2.4ch; appearance: textfield; }
    input[type=number]::-webkit-inner-spin-button { display: none; }`;

  ready() {
    // Not a <form>: when the control is inside a form, the parser drops a <form> from the shadow root's HTML.
    this.form = this.$('.osd');
    this.fields = this.$$('input');
    for (const f of this.fields) if (this.hasAttribute(f.name)) f.value = this.getAttribute(f.name);
    const send = () => {
      const data = new FormData(), name = this.getAttribute('name') || 'timer';
      for (const f of this.fields) data.append(`${name}-${f.name}`, f.value);
      this.setValue(data);
    };
    this.form.addEventListener('input', () => { send(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    send();
  }
  get value() { return Object.fromEntries(this.fields.map((f) => [f.name, f.value])); }
  draw(ctx, w, h, now) {
    const b = dotBoard(this, ctx, { x: 10, y: 10, w: w - 20, h: h - 20, cell: 2, shape: 'square', fill: 1, compose: false }, (c) => put(c, this.form, 0, 0));
    ctx.fillStyle = '#1b1fd0';
    ctx.fillRect(0, 0, w, h);
    // the picture in bands, each a little to one side: a worn tape. One band in a few seconds is torn further.
    const still = reduced(), bands = 22, bh = b.h / bands, tear = still ? -1 : Math.floor(((now / 2600) % 1) * bands * 3);
    const bw = b.big.width, bph = b.big.height / bands;
    for (const [dx, op, a] of [[-1.6, 'lighter', 0.55], [1.6, 'lighter', 0.35], [0, 'source-over', 1]]) {
      ctx.globalCompositeOperation = op; ctx.globalAlpha = a;
      for (let i = 0; i < bands; i++) {
        const wob = still ? 0 : Math.sin(now / 900 + i * 0.7) * 0.5 + (i === tear ? 7 : 0);
        ctx.drawImage(b.big, 0, Math.floor(i * bph), bw, Math.ceil(bph), b.ox + dx + wob, b.oy + i * bh, b.w, bh + 0.5);
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    hit(ctx, this.form, b.ox, b.oy);
    tube(ctx, 0, 0, w, h, now);
    return !still;
  }
}
customElements.define('vcr-timer', VcrTimer);
// #endregion vcr-timer

// #region teletext-command
//   <teletext-command name="page">
//     <option value="101" data-group="News">Headlines</option> …
//   </teletext-command>
// An <input role="combobox"> and a list built from the <option> children. Typing filters the list, the
// arrow keys move through it and Enter or a tap chooses a page.
const TT = ['#ff0', '#0f0', '#0ff', '#f0f'];
export class TeletextCommand extends FeedControl {
  static size = [360, 356];
  static html = `<div class="tt">
      <div class="head"><span class="pg">P100</span><span>INDEX</span><output class="clock"></output></div>
      <label class="find"><span>FIND&gt;</span><input role="combobox" aria-expanded="true" aria-controls="list" aria-autocomplete="list" aria-label="Find a page" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></label>
      <ol id="list" role="listbox" aria-label="Pages"></ol>
      <div class="fast"></div>
    </div>`;
  static css = `
    .tt { width: 344px; height: 340px; padding: 0 4px; color: #fff; font: 700 20px/28px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; display: flex; flex-direction: column; }
    .head { display: flex; gap: 12px; } .head .clock { margin-left: auto; color: #ff0; }
    .find { display: flex; gap: 8px; background: #00f; color: #ff0; padding: 0 6px; margin: 6px 0 10px; }
    input { flex: 1; min-width: 0; font: inherit; color: #fff; background: none; border: 0; outline: 0; padding: 0; caret-color: #fff; text-transform: uppercase; }
    ol { list-style: none; margin: 0; padding: 0; flex: 1; overflow: hidden; }
    li { display: flex; gap: 12px; padding: 0 6px; white-space: nowrap; cursor: pointer; }
    li b { color: #fff; font-weight: 700; }
    li[aria-selected=true] { background: #0ff; color: #000 !important; } li[aria-selected=true] b { color: #000; }
    li[hidden] { display: none; }
    .fast { display: flex; justify-content: space-between; }
    .fast button { font: inherit; background: none; border: 0; padding: 0 4px; margin: 0; outline: 0; touch-action: manipulation; }
    .fast button[aria-pressed=true], .fast button:focus-visible { background: currentColor; -webkit-text-fill-color: #000; }`;

  ready() {
    this.input = this.$('input'); this.list = this.$('ol'); this.fast = this.$('.fast'); this.pg = this.$('.pg');
    this.active = 0; this.group = ''; this.chosen = '';
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.input.addEventListener('input', () => { this.active = 0; this.filter(); });
    this.input.addEventListener('keydown', (e) => {
      const shown = this.shown();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.active = (this.active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % Math.max(1, shown.length); this.filter(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[this.active]) this.choose(shown[this.active].dataset.v); }
      else if (e.key === 'Escape') { this.input.value = ''; this.group = ''; this.active = 0; this.filter(); }
    });
    this.list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) this.choose(li.dataset.v); });
    this.fast.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.group = this.group === b.textContent ? '' : b.textContent; this.active = 0; this.filter(); });
    everySecond(this, () => { this.$('.clock').textContent = clock(); });
  }
  get value() { return this.chosen; }
  shown() { return this.$$('li:not([hidden])'); }
  sync() {
    const opts = options(this), groups = [...new Set(opts.map((o) => o.data.group).filter(Boolean))].slice(0, 4);
    this.list.innerHTML = opts.map((o, i) => `<li role="option" id="o${i}" data-v="${esc(o.value)}" data-g="${esc(o.data.group ?? '')}" style="color:${TT[Math.max(0, groups.indexOf(o.data.group)) % 4]}"><b>${esc(o.value)}</b><span>${esc(o.label)}</span></li>`).join('');
    this.fast.innerHTML = groups.map((g, i) => `<button type="button" aria-pressed="false" style="color:${['#f00', '#0f0', '#ff0', '#0ff'][i]}">${esc(g)}</button>`).join('');
    this.filter();
  }
  filter() {
    const q = this.input.value.trim().toLowerCase();
    for (const li of this.list.children) li.hidden = !(li.textContent.toLowerCase().includes(q) && (!this.group || li.dataset.g === this.group));
    const shown = this.shown();
    this.active = clamp(this.active, 0, Math.max(0, shown.length - 1));
    for (const li of this.list.children) li.setAttribute('aria-selected', String(li === shown[this.active]));
    for (const b of this.fast.children) b.setAttribute('aria-pressed', String(b.textContent === this.group));
    if (shown[this.active]) this.input.setAttribute('aria-activedescendant', shown[this.active].id); else this.input.removeAttribute('aria-activedescendant');
    this.request();
  }
  choose(v) {
    this.chosen = v;
    this.pg.textContent = `P${v}`;
    this.setValue(v);
    this.input.value = ''; this.filter();
    this.flash = performance.now();
    this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }
  draw(ctx, w, h, now) {
    const form = this.$('.tt');
    const b = dotBoard(this, ctx, { x: 8, y: 8, w: w - 16, h: h - 16, cell: 2, shape: 'square', fill: 1, compose: false }, (c) => put(c, form, 0, 0));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    // a new page arrives from the top down
    const age = reduced() ? 1 : clamp((now - (this.flash ?? -1e9)) / 500);
    const rows = Math.round(b.big.height * age);
    ctx.shadowColor = '#fff6'; ctx.shadowBlur = 4;
    if (rows > 0) ctx.drawImage(b.big, 0, 0, b.big.width, rows, b.ox, b.oy, b.w, b.h * age);
    ctx.shadowBlur = 0;
    hit(ctx, form, b.ox, b.oy);
    tube(ctx, 0, 0, w, h, now, { lines: 0.3, band: false });
    return age < 1;
  }
}
customElements.define('teletext-command', TeletextCommand);
// #endregion teletext-command
