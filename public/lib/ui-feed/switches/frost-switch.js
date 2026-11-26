// <frost-switch>: a checkbox drawn as a slide switch under an LCD frost alarm display.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, rr, spring, seg7Text, reduced } from '../kit.js';

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

// #region frost-switch
//   <frost-switch name="frost" temperature="36.4" low="28.8">Frost alarm</frost-switch>
export class FrostSwitch extends SwitchControl {
  static size = [360, 330];
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label>`;
  static css = `
    input { width: 170px; height: 70px; opacity: 0; touch-action: manipulation; }
    label { width: 130px; font: 500 21px/1.15 system-ui, sans-serif; letter-spacing: 2px; text-transform: uppercase; color: #6b4a00; }`;

  draw(ctx, w, h, now) {
    const on = this.checked, moving = spring(this.pos, on ? 1 : 0, this.dt, 300, 24);
    ctx.fillStyle = '#f2b90f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d1d1b'; rr(ctx, 12, 12, w - 24, 216, 8); ctx.fill();
    const lcd = ctx.createLinearGradient(0, 22, 0, 218);
    lcd.addColorStop(0, '#c3c9b8'); lcd.addColorStop(1, '#aab19f');
    ctx.fillStyle = lcd; rr(ctx, 24, 24, w - 48, 192, 3); ctx.fill();
    const ink = '#1c1f18', ghost = '#1c1f1812';
    const temp = (+this.getAttribute('temperature') || 36.4).toFixed(1).padStart(4, ' ');
    const low = (+this.getAttribute('low') || 28.8).toFixed(1);
    seg7Text(ctx, temp, 66, 36, 54, 96, ink, ghost);
    ctx.fillStyle = ink; ctx.font = '700 22px system-ui, sans-serif'; ctx.fillText('°F', 296, 62);
    ctx.font = '600 10px system-ui, sans-serif'; ctx.fillText('OUTDOOR', 30, 20 + 16); ctx.fillText('LOW', 36, 162);
    seg7Text(ctx, low, 70, 146, 13, 24, ink, ghost);
    seg7Text(ctx, on ? 'On' : 'OFF', 70, 178, 13, 24, ink, ghost);
    // the bell shows while the alarm is set, and blinks for two seconds after it is switched on
    const blink = on && (now - (this.changed ?? -1e9) > 2000 || reduced() || Math.floor(now / 250) % 2 === 0);
    ctx.fillStyle = blink ? ink : ghost;
    ctx.beginPath(); ctx.moveTo(38, 200); ctx.quadraticCurveTo(40, 180, 47, 180); ctx.quadraticCurveTo(54, 180, 56, 200); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(47, 202, 3, 0, Math.PI); ctx.fill();
    for (let i = 0; i < 44; i++) {                               // the night's temperatures
      const v = 0.95 * Math.exp(-i / 16) + 0.06 * Math.sin(i * 1.7) + 0.05;
      ctx.fillStyle = ink; ctx.fillRect(150 + i * 4, 204 - v * 56, 3, v * 56);
    }
    // the slide switch
    const sx = 172, sy = 246, sw = 170, sh = 70, tw = 84, tx = sx + 4 + this.pos.x * (sw - tw - 8);
    ctx.fillStyle = '#1b1b19'; rr(ctx, sx, sy, sw, sh, 8); ctx.fill();
    ctx.fillStyle = '#2c2c29'; rr(ctx, sx + 4, sy + 4, sw - 8, sh - 8, 5); ctx.fill();
    const tg = ctx.createLinearGradient(0, sy, 0, sy + sh);
    tg.addColorStop(0, '#55554f'); tg.addColorStop(1, '#30302c');
    ctx.fillStyle = tg; rr(ctx, tx, sy + 5, tw, sh - 10, 5); ctx.fill();
    ctx.fillStyle = '#16161499';
    for (let i = 0; i < 7; i++) ctx.fillRect(tx + 18 + i * 7.5, sy + 18, 3, sh - 36);
    ctx.fillStyle = '#6b4a00'; ctx.font = '600 10px system-ui, sans-serif'; ctx.letterSpacing = '2px';
    ctx.fillText('OFF', sx + 30, sy + sh + 12); ctx.fillText('ON', sx + sw - 54, sy + sh + 12);
    ctx.letterSpacing = '0px';
    hit(ctx, this.input, sx, sy, sw, sh);
    this.ring(ctx, sx - 5, sy - 5, sw + 10, sh + 10, 12, '#1d1d1b');
    put(ctx, this.label, 26, 256);
    return moving || (on && now - (this.changed ?? -1e9) < 2100);
  }
}
customElements.define('frost-switch', FrostSwitch);
// #endregion frost-switch
