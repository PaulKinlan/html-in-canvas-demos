// ui-feed/switches.js: checkboxes drawn as physical switches. Each is a rebuild, in HTML-in-canvas, of a demo
// on https://ui-feed.dev/ (the page that uses them links to each original).
//
//   <mercury-switch name="heating" checked>Heating</mercury-switch>
//   <cradle-switch name="dnd">Do not disturb</cradle-switch>
//   <rocker-switch name="porch">Porch</rocker-switch>
//   <frost-switch name="frost">Frost alarm</frost-switch>
//   <clay-switch name="quiet">Do not disturb</clay-switch>
//   <omr-sheet name="shift" columns="Morning Afternoon Evening"><option value="mon">Monday</option>…</omr-sheet>
//
// Every switch holds one <input type="checkbox" role="switch"> inside its canvas. The canvas draws a model
// (a vial of mercury, a row of steel balls, a rocker) from the input's `checked`, and puts the input's hit
// region over the part of the drawing that a finger would press. Space, Tab, a tap and a form submit all
// go to the input. The label is the element's own text, slotted into a <label> that the canvas draws.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, seg7Text, TAU, reduced } from './kit.js';

// #region switch-base
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
// #endregion switch-base

const ball = (ctx, x, y, r, tint = '#cfd3d8') => {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, tint); g.addColorStop(0.75, '#6f757d'); g.addColorStop(1, '#3d4147');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
};

// #region mercury-switch
export class MercurySwitch extends SwitchControl {
  static size = [360, 330];
  static css = `
    input { width: 240px; height: 200px; opacity: 0; touch-action: manipulation; }
    label { font: 26px Georgia, 'Times New Roman', serif; color: #f3efe2; white-space: nowrap; }
    output { font: italic 26px Georgia, 'Times New Roman', serif; color: #f3efe2; width: 60px; text-align: right; }`;

  ready() { super.ready(); this.blob = { x: this.checked ? 1 : -1, v: 0 }; }
  draw(ctx, w, h) {
    const on = this.checked;
    let moving = spring(this.pos, on ? 1 : 0, this.dt, 60, 9);
    const angle = lerp(-0.26, 0.26, this.pos.x);
    // the mercury runs to the low end of the vial and stops against the glass
    const b = this.blob;
    if (reduced()) { b.x = on ? 1 : -1; b.v = 0; }
    else {
      b.v += Math.sin(angle) * 34 * this.dt; b.v *= Math.exp(-this.dt * 2.2); b.x += b.v * this.dt * 5;
      if (b.x > 1) { b.x = 1; b.v *= -0.25; } else if (b.x < -1) { b.x = -1; b.v *= -0.25; }
      if (Math.abs(b.v) > 0.01 || Math.abs(Math.abs(b.x) - 1) > 0.001) moving = true;
    }
    const made = b.x > 0.9;                               // the mercury joins the two wires

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1f6f6d'); bg.addColorStop(1, '#0d3f44');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cx = 180, cy = 138, R = 104;
    ctx.save();
    ctx.shadowColor = '#0008'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
    const brass = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    brass.addColorStop(0, '#f1d98a'); brass.addColorStop(0.5, '#a9842f'); brass.addColorStop(1, '#e3c873');
    ctx.fillStyle = brass; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.restore();
    const face = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, R);
    face.addColorStop(0, '#fbf5e3'); face.addColorStop(1, '#d9cfb4');
    ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6b5a33'; ctx.lineWidth = 1;
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI * 0.85 + (i / 40) * Math.PI * 0.7, r0 = R - (i % 10 === 0 ? 30 : i % 5 === 0 ? 26 : 22);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); ctx.stroke();
    }
    // the lamp the circuit feeds
    const lx = cx, ly = cy + 62;
    if (made) { const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 46); glow.addColorStop(0, '#ffb347cc'); glow.addColorStop(1, '#ffb34700'); ctx.fillStyle = glow; ctx.fillRect(lx - 46, ly - 46, 92, 92); }
    ctx.fillStyle = '#8a6a22'; ctx.beginPath(); ctx.arc(lx, ly, 12, 0, TAU); ctx.fill();
    const jewel = ctx.createRadialGradient(lx - 3, ly - 3, 1, lx, ly, 9);
    jewel.addColorStop(0, made ? '#fff3c4' : '#c98a4a'); jewel.addColorStop(1, made ? '#ff8a1f' : '#6b3a16');
    ctx.fillStyle = jewel; ctx.beginPath(); ctx.arc(lx, ly, 8.5, 0, TAU); ctx.fill();

    // the vial, on its pivot
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(angle);
    const L = 138, T = 30;
    ctx.strokeStyle = '#b9bcc0'; ctx.lineWidth = 2.5;                 // two wires into the right end
    for (const dy of [-7, 7]) { ctx.beginPath(); ctx.moveTo(L - 34, dy); ctx.lineTo(L + 44, dy); ctx.stroke(); }
    ctx.fillStyle = '#ffffff26'; rr(ctx, -L, -T, L * 2, T * 2, T); ctx.fill();
    // mercury: a pool whose length grows a little as it runs
    const stretch = 1 + Math.min(0.5, Math.abs(b.v) * 0.25), mw = 44 * stretch, mx = b.x * (L - mw - 6);
    const m = ctx.createLinearGradient(0, -T, 0, T);
    m.addColorStop(0, '#f8fafb'); m.addColorStop(0.35, '#aab0b6'); m.addColorStop(0.7, '#5d6369'); m.addColorStop(1, '#c9cdd1');
    ctx.fillStyle = m; rr(ctx, mx - mw, -T + 12, mw * 2, T * 2 - 15, (T * 2 - 15) / 2); ctx.fill();
    ctx.fillStyle = '#ffffffc0'; rr(ctx, mx - mw * 0.6, -T + 16, mw * 0.9, 7, 4); ctx.fill();
    ctx.strokeStyle = '#ffffffa0'; ctx.lineWidth = 2; rr(ctx, -L, -T, L * 2, T * 2, T); ctx.stroke();
    ctx.strokeStyle = '#ffffff70'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-L + 26, -T + 8); ctx.lineTo(L - 40, -T + 8); ctx.stroke();
    ctx.fillStyle = brass; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();   // the clip that holds it
    ctx.fillStyle = '#6b5420'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    ctx.restore();

    hit(ctx, this.input, cx - 150, cy - 110, 300, 220);
    this.ring(ctx, cx - 150, cy - 110, 300, 220, 30);
    put(ctx, this.label, 28, 276);
    put(ctx, this.out, w - 28 - 60, 276);
    return moving;
  }
}
customElements.define('mercury-switch', MercurySwitch);
// #endregion mercury-switch

// #region cradle-switch
export class CradleSwitch extends SwitchControl {
  static size = [360, 330];
  static css = `
    input { width: 300px; height: 90px; opacity: 0; touch-action: manipulation; }
    label { font: 30px Georgia, 'Times New Roman', serif; color: #2b2a27; white-space: nowrap; }
    output { font: italic 30px Georgia, 'Times New Roman', serif; color: #2b2a27; width: 60px; text-align: right; }`;

  draw(ctx, w, h, now) {
    const on = this.checked, r = 19, top = 36, len = 168, cy = top + len, gap = r * 2;
    // one swing angle. Below zero the left ball is out, above zero the right ball is.
    const t = (now - (this.changed ?? -1e9)) / 1000, live = t < 4 && !reduced();
    const dir = on ? -1 : 1;
    const theta = live ? dir * 0.62 * Math.exp(-t * 0.9) * Math.cos(t * 6.4) : 0;
    // the middle ball is the thumb. It is knocked along its slot when the first ball lands.
    const struck = !live || t > Math.PI / 2 / 6.4;
    const moving = spring(this.pos, (struck ? on : !on) ? 1 : 0, this.dt, 260, 20);
    const slide = lerp(-gap * 0.5, gap * 0.5, this.pos.x);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#e9e6df'); bg.addColorStop(1, '#d6d2c8');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4a4a48'; rr(ctx, 60, top - 4, 240, 5, 2.5); ctx.fill();
    ctx.fillStyle = '#c9c5bb'; rr(ctx, 180 - gap - r - 3, cy - r - 3, gap * 2 + r * 2 + 6, r * 2 + 6, r + 3); ctx.fill();   // the slot
    ctx.strokeStyle = '#b3aea3'; ctx.lineWidth = 1; ctx.stroke();
    const xs = [-2, -1, 0, 1, 2].map((i) => 180 + i * gap * 1.02 + (i < 0 ? -gap * 0.5 : i > 0 ? gap * 0.5 : 0));
    xs.forEach((x, i) => {
      const a = i === 0 ? Math.min(0, theta) : i === 4 ? Math.max(0, theta) : 0;
      const px0 = i === 2 ? x + slide : x;
      const bx = px0 + Math.sin(a) * len, by = top + Math.cos(a) * len;
      ctx.strokeStyle = '#77736b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px0, top); ctx.lineTo(bx, by - r); ctx.stroke();
      ctx.fillStyle = '#00000022'; ctx.beginPath(); ctx.ellipse(bx + 4, cy + r + 9, r * 0.9, 4, 0, 0, TAU); ctx.fill();
      ball(ctx, bx, by, r);
    });
    hit(ctx, this.input, 30, cy - 45, 300, 90);
    this.ring(ctx, 180 - gap - r - 8, cy - r - 8, gap * 2 + r * 2 + 16, r * 2 + 16, r + 8, '#2b2a27');
    put(ctx, this.label, 28, 268);
    put(ctx, this.out, w - 28 - 60, 268);
    return moving || live;
  }
}
customElements.define('cradle-switch', CradleSwitch);
// #endregion cradle-switch

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

// #region omr-sheet
//   <omr-sheet name="shift" columns="Morning Afternoon Evening">
//     <option value="mon" data-checked="Morning">Monday</option> …
//   </omr-sheet>
// A form of checkboxes laid out and styled as an answer sheet, drawn as one picture. The canvas draws
// pencil over each checked box, stroke by stroke, and leaves a smudge where a mark was rubbed out.
export class OmrSheet extends FeedControl {
  static size = [360, 400];
  static html = `<div class="sheet"></div>`;
  static css = `
    .sheet { width: 336px; background: #fff; color: #e2007a; font: 700 14px/1 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; text-transform: uppercase; padding: 10px 0 6px 22px; }
    .head, .row { display: grid; grid-template-columns: 104px repeat(var(--n), 1fr); align-items: center; }
    .head { height: 24px; font-size: 9px; letter-spacing: 1px; text-align: center; }
    .row { height: 50px; padding-left: 8px; font-size: 16px; border-top: 1px solid #e2007a; }
    .row:nth-child(even) { background: #fbe3f0; }
    .row label { justify-self: center; position: relative; width: 60px; height: 44px; display: grid; place-items: center; }
    .row input { appearance: none; width: 52px; height: 24px; margin: 0; border: 1.5px solid #e2007a; border-radius: 12px; background: #fff; outline: none; touch-action: manipulation; }
    .row input:focus-visible { box-shadow: 0 0 0 3px #1a1a1a; }
    .row label span { position: absolute; font-size: 10px; pointer-events: none; }`;

  ready() {
    this.form = this.$('.sheet');
    this.marks = new Map();                                     // input -> { amount, smudge }
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true });
    this.form.addEventListener('change', () => { this.send(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  get value() { return [...this.form.querySelectorAll('input:checked')].map((i) => `${i.name}:${i.value}`); }
  send() {
    const data = new FormData(), name = this.getAttribute('name') || 'sheet';
    for (const v of this.value) data.append(name, v);
    this.setValue(data);
    this.request();
  }
  sync() {
    const cols = (this.getAttribute('columns') || 'Yes').split(/\s+/);
    this.form.style.setProperty('--n', cols.length);
    this.form.innerHTML = `<div class="head"><span></span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` +
      options(this).map((o) => `<div class="row"><span>${esc(o.label)}</span>${cols.map((c) => `<label><input type="checkbox" name="${esc(o.value)}" value="${esc(c)}" aria-label="${esc(o.label)}, ${esc(c)}"${(o.data.checked ?? '').split(/\s+/).includes(c) ? ' checked' : ''}><span>${esc(c[0])}</span></label>`).join('')}</div>`).join('');
    this.marks.clear();
    for (const i of this.form.querySelectorAll('input')) this.marks.set(i, { amount: i.checked ? 1 : 0, smudge: 0 });
    this.send();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#e9e4da'; ctx.fillRect(0, 0, w, h);
    const fx = 12, fy = 8;
    ctx.save(); ctx.shadowColor = '#0003'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    put(ctx, this.form, fx, fy);
    ctx.restore();
    let moving = false, n = 0;
    for (const [input, m] of this.marks) {
      const box = input.parentElement;                         // the label is the input's offsetParent
      const x = fx + box.offsetLeft + input.offsetLeft, y = fy + box.offsetTop + input.offsetTop;
      if (n % 3 === 0) { ctx.fillStyle = '#111'; ctx.fillRect(fx + 5, y + 8, 11, 6); }            // timing marks
      const to = input.checked ? 1 : 0;
      if (m.amount !== to) {
        if (to === 0) m.smudge = 1;
        m.amount = reduced() ? to : clamp(m.amount + (to ? 1 : -1) * this.dt * (to ? 3.2 : 6));
        moving = moving || m.amount !== to;
      }
      if (m.smudge > 0 || m.amount > 0) scribble(ctx, x, y, 52, 24, m.amount, m.smudge, n);
      n++;
    }
    return moving;
  }
}
// A pencil mark over a box: a zigzag whose points come from the box's index, so it is the same each frame.
function scribble(ctx, x, y, w, h, amount, smudge, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 233280 + 49297) % 233280; s = (s * 9301 + 49297) % 233280; return s / 233280; };
  ctx.save();
  if (smudge) { ctx.fillStyle = `rgba(60,60,70,${0.1 * smudge})`; rr(ctx, x - 2, y - 1, w + 4, h + 2, h / 2); ctx.fill(); }
  const points = 26, shown = (points - 1) * amount;
  ctx.strokeStyle = '#2b2b33d8'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  let lx = 0, ly = 0;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const px = x + 2 + t * (w - 4) + (rnd() - 0.5) * 3, py = i % 2 ? y + 2 + rnd() * 5 : y + h - 2 - rnd() * 5;
    const part = clamp(shown - (i - 1));
    if (i === 0) ctx.moveTo(px, py);
    else if (part > 0) ctx.lineTo(lerp(lx, px, part), lerp(ly, py, part));
    lx = px; ly = py;
  }
  ctx.stroke();
  ctx.restore();
}
customElements.define('omr-sheet', OmrSheet);
// #endregion omr-sheet
