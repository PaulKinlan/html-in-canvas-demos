// <glass-select>: a native <select> under a WebGL glass lens that refracts the drawn room behind it.
// Standalone HTML-in-canvas custom element. Only dependencies: ../kit.js and ../../glass-gl.js.

import { FeedControl, put, hit, options, esc, rr, TAU } from '../kit.js';
import { glass, glassRoute, onGlassLost } from '../../glass-gl.js';

// #region copy
// A plain 2D canvas for each control to copy into. Never drawable, never willReadFrequently.
const copies = new WeakMap();
function copyOf(control, w, h) {
  let c = copies.get(control);
  if (!c) copies.set(control, c = document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
// Copy a rectangle of the control's own canvas (CSS px) into that plain canvas.
function behind(control, x, y, w, h) {
  const px = control.px;
  const sx = Math.round(x * px), sy = Math.round(y * px), sw = Math.max(1, Math.round(w * px)), sh = Math.max(1, Math.round(h * px));
  const c = copyOf(control, sw, sh);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(control.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return { canvas: c, copy: { sx: 0, sy: 0, sw, sh, x, y, width: w, height: h } };
}
// #endregion copy

// #region glass-select
export class GlassSelect extends FeedControl {
  static size = [360, 300];
  // The scene behind the glass is a <div> of CSS gradients, drawn by the canvas like any other element.
  static html = `<div class="scene"><i class="lamp"></i><i class="sill"></i><i class="pane"></i></div><select></select>`;
  static css = `
    .scene { width: 360px; height: 300px; overflow: hidden;
      background: radial-gradient(120% 90% at 76% 18%, #e8c489 0%, #a9763f 34%, #5c3b22 68%, #22150e 100%); }
    .scene i { position: absolute; display: block; }
    .lamp { left: 250px; top: 18px; width: 120px; height: 120px; border-radius: 50%;
      background: radial-gradient(circle at 40% 38%, #fff6de 0%, #ffd79a 26%, rgba(255,183,97,0.28) 58%, rgba(255,183,97,0) 72%); }
    .sill { left: 0; top: 196px; width: 360px; height: 104px;
      background: linear-gradient(#3a2416 0%, #1d1209 44%, #120b06 100%); }
    .pane { left: 16px; top: 28px; width: 150px; height: 168px; border: 10px solid rgba(26,17,11,0.85); border-radius: 4px;
      background: linear-gradient(160deg, #cfe4f2 0%, #9dc0d8 42%, #6d93b0 100%);
      box-shadow: inset 0 0 0 4px rgba(26,17,11,0.6), 0 10px 40px rgba(255,214,150,0.25); }
    select { width: 240px; height: 64px; padding: 0 22px; border: 0; border-radius: 32px; outline: 0;
      appearance: none; background: transparent; color: #fff; font: 500 26px/64px Georgia, 'Times New Roman', serif; }
    select:focus-visible { box-shadow: 0 0 0 3px #fff; border-radius: 32px; }`;

  ready() {
    this.select = this.$('select'); this.scene = this.$('.scene');
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.select.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); });
    onGlassLost(() => this.request());
  }
  get value() { return this.select.value; }
  set value(v) { this.select.value = v; this.setValue(v); this.request(); }
  sync() {
    const keep = this.select.value;
    this.select.innerHTML = options(this).map((o) => `<option value="${esc(o.value)}"${o.disabled ? ' disabled' : ''}${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    if (keep && [...this.select.options].some((o) => o.value === keep)) this.select.value = keep;
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h) {
    // the scene behind the glass, blurred as a camera would
    ctx.save();
    ctx.filter = 'blur(3px)';
    put(ctx, this.scene, 0, 0, w, h);
    ctx.restore();
    const pill = { x: 48, y: 110, width: 264, height: 76, radius: 38 };
    const src = behind(this, pill.x - 24, pill.y - 24, pill.width + 48, pill.height + 48);
    const out = glass(src.canvas, src.copy, { ...pill, tint: [1, 1, 1, 0.1] }, { rim: 22, thickness: 26, ior: 1.42, dispersion: 0.05, frost: 1.2, specular: 1.1 }, this.px);
    this.route = out ? 'webgl' : glassRoute();
    if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, pill.x, pill.y, pill.width, pill.height);
    else {
      // 2D fallback: the scene again, blurred and brightened inside the pill.
      ctx.save();
      rr(ctx, pill.x, pill.y, pill.width, pill.height, pill.radius); ctx.clip();
      ctx.filter = 'blur(10px) brightness(1.15)';
      ctx.drawImage(src.canvas, pill.x - 24, pill.y - 24, pill.width + 48, pill.height + 48);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(pill.x, pill.y, pill.width, pill.height);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      rr(ctx, pill.x + 1, pill.y + 1, pill.width - 2, pill.height - 2, pill.radius); ctx.stroke();
    }
    // the <select> itself: its text, over the glass
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    put(ctx, this.select, pill.x + 12, pill.y + 6);
    ctx.restore();
    // the arrow, drawn in the right hand bulge of the glass
    const ax = pill.x + pill.width - 38, ay = pill.y + pill.height / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(ax, ay, 17, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(ax - 6, ay - 3); ctx.lineTo(ax, ay + 4); ctx.lineTo(ax + 6, ay - 3); ctx.stroke();
    hit(ctx, this.select, pill.x, pill.y, pill.width, pill.height);
    return false;
  }
}
customElements.define('glass-select', GlassSelect);
// #endregion glass-select
