// <flap-date>: split-flap date display driven by a native <input type="date">.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, smooth, rr, reduced } from '../kit.js';

// #region flap-date
export class FlapDate extends FeedControl {
  static size = [360, 252];
  // One <input type="date"> is the control. The three drums are pictures of three <span>s that hold its
  // parts, so the digits are the page's own text, in the page's font.
  static html = `<input type="date"><label for="d"></label>
    <span class="cell" data-part="0"></span><span class="cell" data-part="1"></span><span class="cell" data-part="2"></span>`;
  static css = `
    input { width: 230px; height: 42px; padding: 0 10px; border: 1px solid #3a3a3a; border-radius: 8px; outline: 0;
      background: #111; color: #eee; font: 17px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color-scheme: dark; }
    input:focus-visible { border-color: #fff; box-shadow: inset 0 0 0 1px #fff; }
    label { color: #9a9a9a; font: 15px system-ui, sans-serif; }
    .cell { display: grid; place-items: center; width: 86px; height: 92px; border-radius: 6px;
      background: linear-gradient(#f7f7f5 0 50%, #e4e4e0 50% 100%); color: #15151a;
      font: 600 40px/92px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; letter-spacing: -1px; }`;

  ready() {
    this.input = this.$('input'); this.label = this.$('label'); this.cells = this.$$('.cell');
    this.input.id = 'd';
    this.label.textContent = this.getAttribute('label') ?? 'Delivery date';
    this.input.value = this.getAttribute('value') ?? '';
    this.shown = ['', '', ''];
    this.flips = [0, 0, 0];
    // The first fill is not a flip: the drums start showing the value the page gave.
    this.shown = this.parts();
    this.cells.forEach((cell, i) => { cell.textContent = this.shown[i]; });
    this.setValue(this.input.value);
    this.input.addEventListener('input', () => { this.fill(); this.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  get value() { return this.input.value; }
  set value(v) { this.input.value = v; this.fill(); }
  parts() {
    const v = this.input.value;
    if (!v) return ['--', '--', '----'];
    const [y, m, d] = v.split('-');
    return [m, d, y];
  }
  fill() {
    const want = this.parts();
    want.forEach((text, i) => {
      if (this.cells[i].textContent === text) return;
      this.flips[i] = 1;                                 // 1 falls to 0 as the flap drops
    });
    this.setValue(this.input.value);
    this.request();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, w, h);
    let moving = false;
    const want = this.parts();
    this.cells.forEach((cell, i) => {
      const x = 16 + i * 110, y = 20, cw = 86, ch = 92;
      // The flap is the top half of the old picture, squashed towards the middle, then the bottom half of
      // the new one rising. Both are pictures of the same element, so it is drawn with its old text first.
      const flip = this.flips[i];
      if (flip > 0) {
        moving = true;
        const step = reduced() ? 1 : this.dt * 3.4;
        this.flips[i] = Math.max(0, flip - step);
        if (flip > 0.5) {
          if (cell.textContent !== this.shown[i]) cell.textContent = this.shown[i] || want[i];
        } else if (cell.textContent !== want[i]) {
          cell.textContent = want[i];
          this.shown[i] = want[i];
        }
      } else if (cell.textContent !== want[i]) { cell.textContent = want[i]; this.shown[i] = want[i]; }

      ctx.save();
      rr(ctx, x, y, cw, ch, 6);
      ctx.clip();
      // the still halves
      const half = ch / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y + half, cw, half); ctx.clip(); put(ctx, cell, x, y, cw, ch); ctx.restore();
      if (flip <= 0) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, half); ctx.clip(); put(ctx, cell, x, y, cw, ch); ctx.restore(); }
      else {
        // the moving flap: the first half of the turn squashes the top down, the second lifts the bottom
        const t = flip > 0.5 ? (flip - 0.5) * 2 : (0.5 - flip) * 2;
        const down = flip > 0.5;
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, cw, half); ctx.clip();
        ctx.translate(x, y + half);
        ctx.scale(1, down ? smooth(t) : smooth(t));
        ctx.translate(-x, -(y + half));
        ctx.save(); ctx.beginPath(); ctx.rect(x, down ? y : y + half, cw, half); ctx.clip();
        put(ctx, cell, x, down ? y : y - half, cw, ch);
        ctx.restore();
        ctx.restore();
        ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - t)})`;
        ctx.fillRect(x, y, cw, half);
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + half); ctx.lineTo(x + cw, y + half); ctx.stroke();
      ctx.restore();
      // the frame and its pins
      ctx.strokeStyle = '#5a5a5e'; ctx.lineWidth = 2;
      rr(ctx, x - 1, y - 1, cw + 2, ch + 2, 7); ctx.stroke();
      ctx.fillStyle = '#2a2a2e';
      for (const px of [x - 4, x + cw + 4]) { rr(ctx, px - 3, y + half - 9, 6, 18, 3); ctx.fill(); }
    });
    put(ctx, this.label, 16, 136);
    put(ctx, this.input, 16, 164);
    hit(ctx, this.input, 16, 164);
    ctx.fillStyle = '#6a6a70';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Month, day and year. The drums are the field’s own text.', 16, 236);
    return moving;
  }
}
customElements.define('flap-date', FlapDate);
// #endregion flap-date
