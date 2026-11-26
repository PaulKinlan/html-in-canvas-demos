// <led-counter>: a <textarea> and <meter> drawn as an LED board and lamp bar.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, dotBoard, clamp, lerp, reduced } from '../kit.js';

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
