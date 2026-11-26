// <teletext-command>: a filtered command list drawn as a teletext CRT display.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, dotBoard, options, esc, clamp, reduced } from '../kit.js';

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
