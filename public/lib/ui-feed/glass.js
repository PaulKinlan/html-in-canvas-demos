// ui-feed/glass.js: controls seen through glass, fog and refracted light. Each is a rebuild, in
// HTML-in-canvas, of a demo on https://ui-feed.dev/ (the page that uses them links to each original).
//
//   <fogged-password name="wifi" label="Wi-Fi password"></fogged-password>
//   <glass-select name="mode"><option value="reading" selected>Reading</option>…</glass-select>
//   <prism-picker name="ink" value="#1000ff"></prism-picker>
//   <foil-picker name="foil" value="#73566a"></foil-picker>
//
// The glass is the shader in /lib/glass-gl.js, the one that the glass skins of <canvas-skin> use. It
// keeps one WebGL 2 context for the page, on a canvas that is never in the document. An element can only
// be drawn by a canvas it is inside, so each control draws its own elements into its own 2D canvas,
// copies that rectangle to a plain canvas with drawImage(), hands the copy to the shader as a texture and
// draws the result back. When there is no WebGL 2 the controls draw a 2D version instead.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from './kit.js';
import { glass, shade, glassRoute, onGlassLost } from '../glass-gl.js';

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

// #region fogged-password
export class FoggedPassword extends FeedControl {
  static size = [360, 300];
  // The mirror is the same text with no dots. It is read only and out of the tab order: the password
  // input is the control. Both are in the canvas, and the mirror is drawn only inside the wiped part.
  static html = `<label for="p"></label><input type="password" id="p" autocomplete="off" spellcheck="false">
    <input type="text" class="mirror" tabindex="-1" aria-hidden="true" readonly spellcheck="false">
    <button type="button" class="eye" aria-pressed="false" aria-label="Show the password"></button>`;
  static css = `
    label { color: #24323c; font: 500 17px system-ui, sans-serif; }
    input { width: 300px; height: 92px; padding: 0 18px; border: 0; outline: 0; background: transparent;
      color: #16222b; caret-color: #16222b; font: 23px/92px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 1px; }
    /* A finger on the pane wipes the fog. Without this the browser takes the drag as a page scroll after a few
       pixels and sends pointercancel, so the wipe stops under the finger. The rest of the card still scrolls. */
    input { touch-action: none; }
    input::selection { background: #16222b; color: #e8f1f5; }
    .eye { width: 44px; height: 44px; margin: 0; padding: 0; border: 1px solid #b9c7ce; border-radius: 10px; background: #fff; outline: 0; touch-action: manipulation; }
    .eye:focus-visible { border-color: #16222b; box-shadow: inset 0 0 0 2px #16222b; }`;

  ready() {
    this.input = this.$('#p'); this.mirror = this.$('.mirror'); this.eye = this.$('.eye'); this.label = this.$('label');
    this.label.textContent = this.getAttribute('label') ?? 'Password';
    this.input.placeholder = this.getAttribute('placeholder') ?? '';
    this.input.value = this.getAttribute('value') ?? '';
    this.wipes = [];                                   // { x, y, r, t } in design units
    this.last = null;
    this.sync();
    this.input.addEventListener('input', () => { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    this.eye.addEventListener('click', () => {
      const on = this.eye.getAttribute('aria-pressed') === 'false';
      this.eye.setAttribute('aria-pressed', String(on));
      this.input.type = on ? 'text' : 'password';
      this.request();
    });
    // The fog is wiped by dragging anywhere over the pane. The password input is under it and still
    // takes taps, focus and typing.
    const pane = { x: 20, y: 76, w: 320, h: 140 };
    const put_ = (e) => {
      const r = this.canvas.getBoundingClientRect(), k = this.constructor.size[0] / r.width;
      const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
      if (x < pane.x || x > pane.x + pane.w || y < pane.y || y > pane.y + pane.h) return;
      const now = performance.now();
      if (this.last) { const d = Math.hypot(x - this.last.x, y - this.last.y); for (let i = 18; i < d; i += 18) this.wipes.push({ x: lerp(this.last.x, x, i / d), y: lerp(this.last.y, y, i / d), r: 26, t: now }); }
      this.wipes.push({ x, y, r: 26, t: now });
      this.last = { x, y };
      if (this.wipes.length > 400) this.wipes.splice(0, this.wipes.length - 400);
      this.request();
    };
    this.canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') put_(e); });
    this.canvas.addEventListener('pointerdown', put_);
    this.canvas.addEventListener('pointerup', () => { this.last = null; });
    this.canvas.addEventListener('pointerleave', () => { this.last = null; });
    this.canvas.addEventListener('pointercancel', () => { this.last = null; });
  }
  get value() { return this.input.value; }
  set value(v) { this.input.value = v; this.sync(); }
  sync() {
    this.mirror.value = this.input.value;
    this.setValue(this.input.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#f7fafb';
    ctx.fillRect(0, 0, w, h);
    put(ctx, this.label, 20, 20);
    put(ctx, this.eye, w - 64, 12);
    const pane = { x: 20, y: 76, w: 320, h: 140 };
    // What is behind the glass: the field, drawn once.
    ctx.save();
    rr(ctx, pane.x, pane.y, pane.w, pane.h, 16);
    ctx.clip();
    ctx.fillStyle = '#eaf1f4';
    ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
    put(ctx, this.input, pane.x + 10, pane.y + 24);
    ctx.restore();

    const src = behind(this, pane.x, pane.y, pane.w, pane.h);
    // The fog over it: the same picture, blurred, lit from the upper left, with the wiped parts cut out.
    ctx.save();
    rr(ctx, pane.x, pane.y, pane.w, pane.h, 16);
    ctx.clip();
    ctx.filter = 'blur(9px) brightness(1.06)';
    ctx.drawImage(src.canvas, pane.x - 6, pane.y - 6, pane.w + 12, pane.h + 12);
    ctx.filter = 'none';
    const haze = ctx.createLinearGradient(pane.x, pane.y, pane.x + pane.w * 0.7, pane.y + pane.h);
    haze.addColorStop(0, 'rgba(255,255,255,0.86)'); haze.addColorStop(0.55, 'rgba(236,243,246,0.8)'); haze.addColorStop(1, 'rgba(206,219,226,0.78)');
    ctx.fillStyle = haze;
    ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
    // Each wipe clears a disc and the fog creeps back over it.
    let fading = false;
    ctx.globalCompositeOperation = 'destination-out';
    for (const p of this.wipes) {
      const age = (now - p.t) / 9000;
      if (age >= 1) continue;
      fading = true;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const a = 1 - smooth(age);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.7, `rgba(0,0,0,${a * 0.8})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // The clear text, only where the fog has been wiped away.
    if (fading) {
      ctx.save();
      ctx.beginPath();
      for (const p of this.wipes) { if ((now - p.t) / 9000 < 0.62) { ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r * 0.94, 0, TAU); } }
      ctx.clip();
      put(ctx, this.mirror, pane.x + 10, pane.y + 24);
      ctx.restore();
    }
    ctx.restore();
    // The hit region of the password input covers the whole pane.
    hit(ctx, this.input, pane.x, pane.y, pane.w, pane.h);
    if (this.input.matches(':focus-visible')) { ctx.strokeStyle = '#16222b'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); rr(ctx, pane.x + 3, pane.y + 3, pane.w - 6, pane.h - 6, 13); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#6b7f8a';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(this.wipes.length ? 'Keep wiping to read it' : 'Wipe the glass with a finger', 22, 244);
    ctx.fillText(`${this.input.value.length} characters`, 22, 266);
    return fading;
  }
}
customElements.define('fogged-password', FoggedPassword);
// #endregion fogged-password

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

// #region spectrum
// An approximate sRGB colour for a wavelength in nanometres (Dan Bruton's piecewise fit).
export function wavelengthRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  let f = 1;
  if (nm >= 380 && nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700 && nm <= 780) f = 0.3 + (0.7 * (780 - nm)) / 80;
  const k = (v) => Math.round(255 * (v * f) ** 0.8);
  return [k(r), k(g), k(b)];
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
// #endregion spectrum

// #region prism-optics
// A ray traced through a glass prism. The index of the glass is Cauchy's formula, n = A + B / lambda squared,
// so each wavelength bends by its own amount: that is the whole of the dispersion.
export const indexOf = (nm) => 1.598 + 11200 / (nm * nm);

const dot = (a, b) => a.x * b.x + a.y * b.y;
const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const reflectD = (d, n) => ({ x: d.x - 2 * dot(d, n) * n.x, y: d.y - 2 * dot(d, n) * n.y });

// Snell's law as vectors. eta is n1 / n2. Null means the angle is past the critical one.
function refract(d, n, eta) {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const c2 = Math.sqrt(k);
  return norm({ x: eta * d.x + (eta * cosi - c2) * n.x, y: eta * d.y + (eta * cosi - c2) * n.y });
}

// The nearest edge of the polygon that the ray meets, with the normal turned to face the ray.
function hitPoly(o, d, poly, eps = 0.001) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = (d.x * (a.y - o.y) - d.y * (a.x - o.x)) / -den;
    if (t <= eps || u < 0 || u > 1) continue;
    if (!best || t < best.t) {
      let n = norm({ x: ey, y: -ex });
      if (dot(n, d) > 0) n = { x: -n.x, y: -n.y };          // the normal faces the ray
      best = { t, p: { x: o.x + d.x * t, y: o.y + d.y * t }, n };
    }
  }
  return best;
}

// One ray of one wavelength: in through the first face, through the glass, out of another, with any number
// of total internal reflections on the way. Returns the path and the ray that leaves, if one does.
export function traceRay(o, d, poly, n) {
  const first = hitPoly(o, d, poly);
  if (!first) return null;
  const path = [o, first.p];
  let dir = refract(d, first.n, 1 / n);
  if (!dir) return { path, exit: null };
  let at = first.p;
  for (let bounce = 0; bounce < 6; bounce++) {
    const next = hitPoly(at, dir, poly);
    if (!next) break;
    path.push(next.p);
    const out = refract(dir, next.n, n);
    if (out) return { path, exit: { p: next.p, d: out } };
    dir = reflectD(dir, next.n);                             // past the critical angle: it stays inside
    at = next.p;
  }
  return { path, exit: null };
}
// #endregion prism-optics

// #region prism-picker
// Three native ranges: the wavelength to pick, a hue shift on the colour it gives, and the angle the prism
// is turned to. The picture is a real trace: 61 wavelengths through the glass, each at its own index.
export class PrismPicker extends FeedControl {
  static size = [360, 336];
  static html = `<input type="range" class="nm" min="380" max="700" step="1" aria-label="Wavelength in nanometres">
    <input type="range" class="hue" min="-180" max="180" step="1" aria-label="Hue shift in degrees">
    <input type="range" class="angle" min="0" max="90" step="1" aria-label="Angle of the prism in degrees">
    <input type="color" class="swatch" aria-label="Colour"><output class="read"></output>`;
  static css = `
    input[type=range] { width: 300px; height: 44px; margin: 0; background: transparent; touch-action: pan-y; }
    input[type=range]:focus-visible { outline: 2px dashed #fff; outline-offset: 4px; }
    .swatch { width: 28px; height: 28px; padding: 0; border: 1px solid #555; border-radius: 4px; background: none; }
    .swatch::-webkit-color-swatch-wrapper { padding: 0; }
    .swatch::-webkit-color-swatch { border: 0; }
    .read { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); color: #000; }`;

  ready() {
    this.nmRange = this.$('.nm'); this.hueRange = this.$('.hue'); this.angleRange = this.$('.angle');
    this.swatch = this.$('.swatch'); this.read = this.$('.read');
    this.range = this.nmRange;                                   // the wavelength is the main control
    this.nmRange.value = this.getAttribute('wavelength') ?? 459;
    this.hueRange.value = this.getAttribute('hue') ?? 0;
    this.angleRange.value = this.getAttribute('angle') ?? 18;
    for (const r of [this.nmRange, this.hueRange, this.angleRange]) {
      r.addEventListener('input', () => { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    this.swatch.addEventListener('input', () => { this.setValue(this.swatch.value); this.request(); });
    this.sync();
  }
  get value() { return this.swatch.value; }
  get nm() { return +this.nmRange.value; }
  get shift() { return +this.hueRange.value; }
  get angle() { return +this.angleRange.value; }
  // The colour of the chosen wavelength, turned around the hue circle by the second range.
  colour() {
    const [r, g, b] = wavelengthRGB(this.nm);
    if (!this.shift) return [r, g, b];
    const hsb = rgbToHsb(hex([r, g, b]));
    return hsbToRgb((hsb[0] + this.shift + 360) % 360, hsb[1], hsb[2]);
  }
  sync() {
    const rgb = this.colour();
    this.swatch.value = hex(rgb);
    this.read.textContent = `${this.nm} nm, hue shifted ${this.shift} degrees, prism at ${this.angle} degrees: ${this.swatch.value}`;
    this.setValue(this.swatch.value);
    this.request();
  }
  // The prism, as a triangle turned by the angle range.
  prism() {
    // Vertex 0 points up at an angle of nothing: the apex of the classic prism, which bends the light down.
    const cx = 126, cy = 84, R = 62, a = (this.angle * Math.PI) / 180 - Math.PI / 2;
    return [0, 1, 2].map((i) => ({ x: cx + Math.cos(a + (i * TAU) / 3) * R, y: cy + Math.sin(a + (i * TAU) / 3) * R }));
  }

  draw(ctx, w, h) {
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, w, h);
    const poly = this.prism(), nm = this.nm, rgb = this.colour();
    const o = { x: -40, y: 84 }, d = { x: 1, y: 0 };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, 196); ctx.clip();        // the scene, so no ray crosses the controls

    // the beam coming in, as far as the glass
    const first = traceRay(o, d, poly, indexOf(nm));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (first) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(0, o.y); ctx.lineTo(first.path[1].x, first.path[1].y); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // the fan: one ray for each wavelength, each with its own index, drawn where it leaves the glass
    let mark = null;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, nmi = lerp(380, 700, t), c = wavelengthRGB(nmi);
      const ray = traceRay(o, d, poly, indexOf(nmi));
      if (!ray) continue;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 1; k < ray.path.length; k++) ctx[k === 1 ? 'moveTo' : 'lineTo'](ray.path[k].x, ray.path[k].y);
      if (ray.path.length > 2) ctx.stroke();                     // the path inside the glass
      if (!ray.exit) continue;
      const e = ray.exit;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.42)`;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(e.p.x, e.p.y); ctx.lineTo(e.p.x + e.d.x * 300, e.p.y + e.d.y * 300); ctx.stroke();
      if (Math.abs(nmi - nm) < 320 / 60) mark = e;
    }

    // the chosen wavelength, brighter, over the fan
    const own = traceRay(o, d, poly, indexOf(nm));
    if (own?.exit) {
      const e = own.exit;
      ctx.strokeStyle = `rgb(${rgb.join(',')})`;
      ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.moveTo(e.p.x, e.p.y); ctx.lineTo(e.p.x + e.d.x * 320, e.p.y + e.d.y * 320); ctx.stroke();
      ctx.shadowBlur = 0;
      mark = e;
    }
    ctx.restore();

    // where the chosen ray leaves the scene
    if (mark) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgb(${rgb.join(',')})`;
      // The nearest edge of the scene the ray reaches, which depends on the way it is going: a ray
      // leaving upwards meets y = 4, one leaving downwards meets y = 192.
      const ks = [[4 - mark.p.y, mark.d.y], [192 - mark.p.y, mark.d.y], [4 - mark.p.x, mark.d.x], [356 - mark.p.x, mark.d.x]]
        .filter(([n, dd]) => Math.abs(dd) > 1e-6 && n / dd > 0).map(([n, dd]) => n / dd);
      const k = ks.length ? Math.min(...ks) : 0;
      ctx.beginPath(); ctx.arc(mark.p.x + mark.d.x * k, mark.p.y + mark.d.y * k, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // the glass itself, over the rays
    ctx.save();
    ctx.beginPath();
    poly.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    ctx.closePath();
    const g = ctx.createLinearGradient(poly[0].x, poly[0].y, poly[2].x, poly[2].y);
    g.addColorStop(0, 'rgba(214,226,238,0.26)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(214,226,238,0.3)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    ctx.restore();                                              // the scene clip
    if (!own?.exit) {
      ctx.fillStyle = '#9aa0ab';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Past the critical angle: the light stays in the glass.', 18, 188);
    }

    // the three tracks. The ranges themselves are never painted, only placed.
    const bar = { x: 30, y: 222, w: 300, h: 14 };
    for (let i = 0; i < bar.w; i++) {
      const c = wavelengthRGB(lerp(380, 700, i / bar.w));
      ctx.fillStyle = `rgb(${c.join(',')})`;
      ctx.fillRect(bar.x + i, bar.y, 1.2, bar.h);
    }
    hit(ctx, this.nmRange, bar.x, bar.y - 15, bar.w, 44);
    const tx = bar.x + ((nm - 380) / 320) * bar.w;
    ctx.fillStyle = '#fff';
    rr(ctx, tx - 2, bar.y - 8, 4, bar.h + 16, 2); ctx.fill();
    if (this.nmRange.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(bar.x - 4, bar.y - 12, bar.w + 8, bar.h + 24); ctx.setLineDash([]); }

    const track = (y, range, frac, fill) => {
      ctx.fillStyle = '#23242a';
      rr(ctx, 30, y, 300, 8, 4); ctx.fill();
      ctx.fillStyle = fill;
      rr(ctx, 30, y, Math.max(8, 300 * frac), 8, 4); ctx.fill();
      hit(ctx, range, 30, y - 18, 300, 44);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(30 + 300 * frac, y + 4, 7, 0, TAU); ctx.fill();
      if (range.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(26, y - 8, 308, 24); ctx.setLineDash([]); }
    };
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#8d929c';
    ctx.fillText(`Wavelength ${nm} nm`, 30, 214);
    ctx.fillText(`Hue shift ${this.shift > 0 ? '+' : ''}${this.shift}°`, 30, 258);
    track(266, this.hueRange, (this.shift + 180) / 360, `rgb(${rgb.join(',')})`);
    ctx.fillStyle = '#8d929c';
    ctx.fillText(`Prism at ${this.angle}°`, 30, 300);
    track(308, this.angleRange, this.angle / 90, '#6f7682');

    put(ctx, this.swatch, 302, 196);
    return false;
  }
}
customElements.define('prism-picker', PrismPicker);
// #endregion prism-picker

// #region foil-picker
const FOIL = `
vec4 shade(vec2 p) {
  vec2 uv = p / uSize + 0.5;
  float d = sdBox(p);
  // interference: the film's thickness changes across the square and with the tilt, and each
  // wavelength reinforces at its own thickness, which is why the bands are rainbow coloured
  float film = uv.x * 2.2 + uv.y * 0.8 + uTilt * 1.4 + 0.25 * sin(uv.y * 9.0 + uTime * 0.25);
  vec3 bands = 0.5 + 0.5 * cos(6.2831 * (film + vec3(0.0, 0.33, 0.66)) * 3.0);
  vec3 col = mix(uInk.rgb, bands, uSat) * mix(0.35, 1.25, uBright);
  float sheen = pow(max(0.0, 1.0 - abs(uv.x - 0.5 - uTilt * 0.25) * 2.4), 6.0);
  col += sheen * 0.5;
  float a = smoothstep(1.0, -1.0, d * uScale) ;
  return vec4(col, a);
}`;

export class FoilPicker extends FeedControl {
  static size = [360, 330];
  static fps = 24;
  static html = `<input type="range" class="hue" min="0" max="360" aria-label="Hue">
    <input type="range" class="sat" min="0" max="100" aria-label="Saturation">
    <input type="range" class="bright" min="0" max="100" aria-label="Brightness">
    <input type="color" class="swatch" aria-label="Colour"><output class="read"></output>`;
  static css = `
    input[type=range] { width: 260px; height: 36px; margin: 0; background: transparent; touch-action: pan-y; }
    input[type=range]:focus-visible { outline: 2px dashed #fff; outline-offset: 3px; }
    .swatch { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 3px; background: none; }
    .swatch::-webkit-color-swatch-wrapper { padding: 0; }
    .swatch::-webkit-color-swatch { border: 0; }
    .read { width: 320px; color: #cfd3dc; user-select: none; font: 700 26px/30px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 1px; }`;

  ready() {
    this.hue = this.$('.hue'); this.sat = this.$('.sat'); this.bright = this.$('.bright');
    this.swatch = this.$('.swatch'); this.read = this.$('.read');
    const start = this.getAttribute('value') ?? '#73566a';
    const [hh, ss, bb] = rgbToHsb(start);
    this.hue.value = Math.round(hh); this.sat.value = Math.round(ss); this.bright.value = Math.round(bb);
    for (const r of [this.hue, this.sat, this.bright]) r.addEventListener('input', () => { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    this.sync();
    onGlassLost(() => this.request());
  }
  get value() { return this.swatch.value; }
  sync() {
    this.swatch.value = hsbToHex(+this.hue.value, +this.sat.value, +this.bright.value);
    this.read.textContent = this.swatch.value.toUpperCase();
    this.setValue(this.swatch.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);
    const panel = { width: 320, height: 150, radius: 14 };
    const ink = [...hsbToRgb(+this.hue.value, 100, 100).map((v) => v / 255), 1];
    const tilt = reduced() ? 0 : Math.sin(now / 2600) * 0.5;
    const out = shade('ui-feed-foil', FOIL, panel, this.px, { uInk: ink, uSat: +this.sat.value / 100, uBright: +this.bright.value / 100, uTilt: tilt });
    this.route = out ? 'webgl' : glassRoute();
    if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, 20, 20, panel.width, panel.height);
    else {
      // 2D fallback: bands of the same colours, with no interference computed per pixel.
      ctx.save();
      rr(ctx, 20, 20, panel.width, panel.height, 14); ctx.clip();
      for (let i = 0; i < panel.width; i++) {
        const t = (i / panel.width) * 3 + tilt;
        const band = [0, 0.33, 0.66].map((o) => 0.5 + 0.5 * Math.cos(TAU * (t + o) * 3));
        const col = band.map((v, j) => Math.round(255 * lerp(ink[j], v, +this.sat.value / 100) * lerp(0.35, 1.25, +this.bright.value / 100)));
        ctx.fillStyle = `rgb(${col.map((v) => clamp(v, 0, 255)).join(',')})`;
        ctx.fillRect(20 + i, 20, 1.2, panel.height);
      }
      ctx.restore();
    }
    // the three ranges, drawn as marks over the foil and under it
    const rows = [[this.hue, 'H'], [this.sat, 'S'], [this.bright, 'B']];
    rows.forEach(([r, name], i) => {
      const y = 214 + i * 36, x = 50, bw = 260;
      ctx.fillStyle = '#1b1e26';
      rr(ctx, x, y + 11, bw, 6, 3); ctx.fill();
      const t = (r.value - r.min) / (r.max - r.min);
      ctx.fillStyle = name === 'H' ? `hsl(${r.value} 90% 55%)` : '#9aa1ae';
      rr(ctx, x, y + 11, bw * t, 6, 3); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x + bw * t, y + 14, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6a6f79'; ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(name, 28, y + 19);
      hit(ctx, r, x - 10, y, bw + 20, 36);
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, x - 8, y + 2, bw + 16, 32, 16); ctx.stroke(); ctx.setLineDash([]); }
    });
    put(ctx, this.read, 54, 178);
    put(ctx, this.swatch, 22, 180);
    return !reduced();
  }
}
customElements.define('foil-picker', FoilPicker);
// #endregion foil-picker

// #region colour
function rgbToHsb(h) {
  const n = parseInt(h.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) hue = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(hue + 360) % 360, mx ? (d / mx) * 100 : 0, mx * 100];
}
export function hsbToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255));
}
function hsbToHex(h, s, v) { return hex(hsbToRgb(h, s, v)); }
// #endregion colour
