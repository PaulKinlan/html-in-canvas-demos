// <foil-picker>: a colour picker whose panel is computed as thin-film interference by a WebGL shader.
// Standalone HTML-in-canvas custom element. Only dependencies: ../kit.js and ../../glass-gl.js.

import { FeedControl, put, hit, clamp, lerp, rr, TAU, reduced } from '../kit.js';
import { shade, glassRoute, onGlassLost } from '../../glass-gl.js';

const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

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
