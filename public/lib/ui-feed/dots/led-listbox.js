// <led-listbox>: a single-choice <select size> list drawn as an LED board.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, dotBoard, options, esc, reduced } from '../kit.js';

// #region led-listbox
// The original is a listbox, so this one is a native <select size>: the rows, the selection highlight, the
// arrow keys, type-ahead and the scrolling are all the browser's. The canvas draws it as an LED board.
export class LedListbox extends FeedControl {
  static size = [360, 270];
  static html = `<select size="5" aria-label="Showing"></select>`;
  static css = `
    select { width: 344px; height: 246px; padding: 0; border: 0; outline: 0; overflow: hidden;
      background: #08090b; color: #d9dde6; font: 700 19px/1.2 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace;
      text-transform: uppercase; }
    option { padding: 11px 8px; border-bottom: 4px solid #3a3f4a; background: #08090b; color: #d9dde6; }
    option:checked { background: #c9ced8; color: #0a0b0e; }
    option:disabled { color: #4a4f5a; }`;

  ready() {
    this.list = this.$('select');
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.list.addEventListener('change', () => {
      this.setValue(this.value);
      this.flash = performance.now();
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  get value() { return this.list.value; }
  set value(v) { this.list.value = String(v); this.setValue(this.value); this.request(); }
  // Where each row is on the board, in the control's units. An <option> of a listbox reports offsetTop.
  rows() {
    const b = this.board ?? { oy: 8 };
    return [...this.list.options].map((o) => ({ option: o, y: b.oy + 4 + this.slice(o, this.list).top + o.offsetHeight / 2 }));
  }
  // The rows are the author's <option> children. data-time, data-meta and data-note are padded into the
  // option's own text, because an <option> holds text and not a layout.
  sync() {
    const keep = this.list.value, list = options(this);
    this.list.innerHTML = list.map((o) => {
      const text = `${(o.data.time ?? '').padEnd(6)}${o.label}`.padEnd(20).slice(0, 20) + (o.data.note || o.data.meta || '');
      return `<option value="${esc(o.value)}"${o.disabled ? ' disabled' : ''}${o.selected ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('');
    if (keep && [...this.list.options].some((o) => o.value === keep)) this.list.value = keep;
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
