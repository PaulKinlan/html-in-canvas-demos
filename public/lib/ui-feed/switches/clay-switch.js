// <clay-switch>: a checkbox drawn as a soft clay slab with a squashing spring thumb.
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

// #region clay-switch
export class ClaySwitch extends SwitchControl {
  static size = [360, 300];
  static css = `
    input { width: 280px; height: 130px; opacity: 0; touch-action: manipulation; }
    label { font: 700 25px system-ui, sans-serif; color: #2d2a6e; white-space: nowrap; }
    output { font: 700 25px system-ui, sans-serif; color: #7a6ad0; width: 50px; text-align: right; }`;

  draw(ctx, w, h) {
    const on = this.checked, moving = spring(this.pos, on ? 1 : 0, this.dt, 150, 11);
    const p = this.pos.x, v = clamp(Math.abs(this.pos.v) / 6, 0, 0.35);
    ctx.fillStyle = '#fbf0cf'; ctx.fillRect(0, 0, w, h);
    // the slab: a drop shadow, then light from the top left and shade at the bottom right
    ctx.save(); ctx.shadowColor = '#7a62c466'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#b9a4f2'; rr(ctx, 24, 24, w - 48, h - 48, 46); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, 24, 24, w - 48, h - 48, 46); ctx.clip();
    ctx.shadowColor = '#ffffffb0'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 8; ctx.shadowOffsetY = 8;
    ctx.strokeStyle = '#b9a4f2'; ctx.lineWidth = 16; rr(ctx, 16, 16, w - 32, h - 32, 54); ctx.stroke();
    ctx.shadowColor = '#5a44a680'; ctx.shadowOffsetX = -8; ctx.shadowOffsetY = -8; ctx.stroke();
    ctx.restore();
    // the groove, pressed in
    const gx = 50, gy = 122, gw = w - 100, gh = 116;
    const track = `rgb(${lerp(226, 255, clamp(p))}, ${lerp(206, 190, clamp(p))}, ${lerp(245, 150, clamp(p))})`;
    ctx.fillStyle = track; rr(ctx, gx, gy, gw, gh, gh / 2); ctx.fill();
    ctx.save(); rr(ctx, gx, gy, gw, gh, gh / 2); ctx.clip();
    ctx.shadowColor = '#3a2a7a80'; ctx.shadowBlur = 14; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 8;
    ctx.strokeStyle = track; ctx.lineWidth = 14; rr(ctx, gx - 7, gy - 7, gw + 14, gh + 14, gh / 2 + 7); ctx.stroke();
    ctx.restore();
    // the thumb is soft: it is wider and flatter while it moves
    const tr = 46, tx = lerp(gx + gh / 2, gx + gw - gh / 2, p), ty = gy + gh / 2;
    ctx.save(); ctx.translate(tx, ty); ctx.scale(1 + v, 1 - v * 0.6);
    ctx.shadowColor = '#6a4a3080'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 9;
    const tg = ctx.createRadialGradient(-14, -16, 4, 0, 0, tr);
    tg.addColorStop(0, '#fffdf6'); tg.addColorStop(1, '#f1e2c4');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, 0, tr, 0, TAU); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = on ? '#f08a4b' : '#c4a37a'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-15, 10); ctx.quadraticCurveTo(-11, 8, -11, -2); ctx.quadraticCurveTo(-11, -16, 0, -16); ctx.quadraticCurveTo(11, -16, 11, -2); ctx.quadraticCurveTo(11, 8, 15, 10); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 16, 4, 0, Math.PI); ctx.stroke();
    ctx.restore();
    hit(ctx, this.input, 40, gy - 8, 280, 130);
    this.ring(ctx, gx - 6, gy - 6, gw + 12, gh + 12, gh / 2 + 6, '#2d2a6e');
    put(ctx, this.label, 54, 62);
    put(ctx, this.out, w - 54 - 50, 62);
    return moving;
  }
}
customElements.define('clay-switch', ClaySwitch);
// #endregion clay-switch
