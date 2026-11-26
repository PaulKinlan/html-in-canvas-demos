// <vcr-timer>: native date, time and number inputs drawn behind a VHS tube effect.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, dotBoard, reduced } from '../kit.js';

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
