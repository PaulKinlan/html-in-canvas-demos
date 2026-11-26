// <rocker-switch>: a checkbox drawn as an industrial rocker with a pilot lamp and nameplate.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, spring, TAU } from '../kit.js';

class SwitchControl extends FeedControl {
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label><output aria-hidden="true"></output>`;
  static observedAttributes = ['checked'];

  ready() {
    this.input = this.$('input'); this.label = this.$('label'); this.out = this.$('output');
    this.input.checked = this.hasAttribute('checked');
    this.pos = { x: this.input.checked ? 1 : 0, v: 0 };
    this.input.addEventListener('change', () => { this.changed = performance.now(); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.sync();
  }
  attributeChangedCallback() { if (this.input) this.checked = this.hasAttribute('checked'); }
  get checked() { return this.input?.checked ?? this.hasAttribute('checked'); }
  set checked(v) { if (this.input.checked !== !!v) { this.input.checked = !!v; this.changed = performance.now(); } this.sync(); }
  sync() {
    this.setValue(this.input.checked ? this.getAttribute('value') ?? 'on' : null);
    if (this.out) this.out.textContent = this.input.checked ? 'On' : 'Off';
    this.input.ariaLabel = this.textContent.trim() || null;
    this.request();
  }
  // a ring where the input was put, when it has keyboard focus
  ring(ctx, x, y, w, h, r, colour = '#fff') {
    if (!this.input.matches(':focus-visible')) return;
    ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
  }
}

// #region rocker-switch
export class RockerSwitch extends SwitchControl {
  static size = [116, 300];
  static radius = 0;
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label>`;
  static css = `
    input { width: 80px; height: 140px; opacity: 0; touch-action: manipulation; }
    label { width: 84px; height: 34px; border-radius: 4px; background: #e9e2cf; color: #2d2f28; font: 700 15px/34px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 1.5px; text-align: center; text-transform: uppercase; box-shadow: inset 0 -2px 0 #0003; overflow: hidden; }`;

  draw(ctx, w, h) {
    const moving = spring(this.pos, this.checked ? 1 : 0, this.dt, 420, 22);
    const p = clamp(this.pos.x, -0.1, 1.1);
    ctx.fillStyle = '#4b5046'; ctx.fillRect(0, 0, w, h);
    const lx = w / 2, ly = 34;
    if (p > 0.5) { const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 34); g.addColorStop(0, '#ffb62ecc'); g.addColorStop(1, '#ffb62e00'); ctx.fillStyle = g; ctx.fillRect(lx - 34, ly - 34, 68, 68); }
    ctx.fillStyle = '#23261f'; ctx.beginPath(); ctx.arc(lx, ly, 11, 0, TAU); ctx.fill();
    const lamp = ctx.createRadialGradient(lx - 2, ly - 3, 1, lx, ly, 8);
    lamp.addColorStop(0, p > 0.5 ? '#fff1b8' : '#8a5a2a'); lamp.addColorStop(1, p > 0.5 ? '#ff9d1e' : '#4a2d12');
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(lx, ly, 8, 0, TAU); ctx.fill();
    const x = 18, y = 66, bw = 80, bh = 140;
    ctx.fillStyle = '#16180f'; rr(ctx, x, y, bw, bh, 8); ctx.fill();
    // two faces. The pressed half is seen from further round, so it is shorter and darker.
    const topH = lerp(0.56, 0.44, p) * (bh - 12), botH = bh - 12 - topH;
    const face = (yy, hh, lit, text) => {
      const g = ctx.createLinearGradient(0, yy, 0, yy + hh);
      g.addColorStop(0, lit ? '#f7f3e6' : '#bdb8a8'); g.addColorStop(1, lit ? '#e0dac8' : '#9a9586');
      ctx.fillStyle = g; rr(ctx, x + 6, yy, bw - 12, hh, 4); ctx.fill();
      ctx.fillStyle = '#2d2f28'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + bw / 2, yy + hh / 2);
    };
    face(y + 6, topH, p < 0.5, 'I');
    face(y + 6 + topH, botH, p >= 0.5, 'O');
    ctx.fillStyle = '#0005'; ctx.fillRect(x + 6, y + 6 + topH - 1, bw - 12, 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    hit(ctx, this.input, x, y, bw, bh);
    this.ring(ctx, x - 5, y - 5, bw + 10, bh + 10, 12);
    put(ctx, this.label, 16, 236);
    return moving;
  }
}
customElements.define('rocker-switch', RockerSwitch);
// #endregion rocker-switch
