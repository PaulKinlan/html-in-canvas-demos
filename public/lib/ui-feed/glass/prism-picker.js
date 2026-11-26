// <prism-picker>: a colour picker that traces white light through a glass prism onto a slit.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, TAU } from '../kit.js';

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

function rgbToHsb(h) {
  const n = parseInt(h.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) hue = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(hue + 360) % 360, mx ? (d / mx) * 100 : 0, mx * 100];
}
function hsbToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255));
}

// #region prism-optics
// A ray traced through a glass prism. The index of the glass is Cauchy's formula, n = A + B / lambda squared,
// so each wavelength bends by its own amount: that is the whole of the dispersion.
export const indexOf = (nm) => 1.582 + 16000 / (nm * nm);       // a dense flint: 1.69 at 380 nm, 1.61 at 700

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
// Fresnel's equations for light with no polarisation: the share that is reflected at a face. cosi is the
// cosine of the angle to the normal, n1 the index the ray is in and n2 the one it is going into.
function fresnel(cosi, n1, n2) {
  const s2 = (n1 / n2) ** 2 * (1 - cosi * cosi);
  if (s2 >= 1) return 1;
  const cost = Math.sqrt(1 - s2);
  const rs = ((n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost)) ** 2, rp = ((n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi)) ** 2;
  return (rs + rp) / 2;
}

// Everything one ray of one wavelength does: at each face part is reflected and part refracted, in the shares
// Fresnel's equations give, and both go on. Returns the reflection off the first face, the legs inside the
// glass, and every ray that leaves, each with the share of the light it carries. The first ray out is the beam
// the eye follows; the later ones are the faint ghosts that leave through the other faces.
export function traceLight(o, d, poly, n, bounces = 4) {
  const first = hitPoly(o, d, poly);
  if (!first) return null;
  const r0 = fresnel(-dot(d, first.n), 1, n);
  const light = { enter: first.p, glance: { p: first.p, d: reflectD(d, first.n), w: r0 }, legs: [], out: [] };
  let dir = refract(d, first.n, 1 / n), at = first.p, w = 1 - r0;
  for (let k = 0; dir && k <= bounces && w > 0.004; k++) {
    const next = hitPoly(at, dir, poly);
    if (!next) break;
    light.legs.push({ a: at, b: next.p, w });
    const out = refract(dir, next.n, n), r = fresnel(-dot(dir, next.n), n, 1);
    if (out) light.out.push({ p: next.p, d: out, w: w * (1 - r) });
    w *= r;
    dir = reflectD(dir, next.n);
    at = next.p;
  }
  return light;
}
// #endregion prism-optics

// #region prism-picker
// A colour picker that is an optical bench. White light goes into a glass prism, the prism spreads it, and a
// screen with a slit in it lets one wavelength through: that wavelength is the colour. Turning the prism sweeps
// the spectrum across the slit. Three native inputs hold it: a range for the angle of the prism, placed over the
// dial so that it is turned by hand, a range for the wavelength and a range for the hue. They are one quantity
// seen three ways, so setting the wavelength or the hue solves for the angle and the prism turns to it.
export class PrismPicker extends FeedControl {
  static size = [360, 336];
  static C = { x: 128, y: 86 };                 // the centre of the prism and of its dial
  static R = 52;                                // from the centre to a corner
  static DIAL = 76;
  static BEAM = { x: -40, y: 86 };
  static SCENE = 232;                           // the bench is the top of the control
  static SLIT = { x: 225, y: 207, half: 40, gap: 1.8, facing: 56 };     // a little past least deviation, so every wavelength can reach it
  static html = `<input type="range" class="angle" min="0" max="120" step="0.05" aria-label="Angle of the prism in degrees">
    <input type="range" class="nm" min="380" max="700" step="1" aria-label="Wavelength in nanometres">
    <input type="range" class="hue" min="0" max="280" step="1" aria-label="Hue in degrees">
    <input type="color" class="swatch" aria-label="Colour"><output class="read"></output>`;
  static css = `
    input[type=range] { width: 244px; height: 40px; margin: 0; background: transparent; touch-action: pan-y; }
    /* The dial is turned with a finger in any direction, so the browser must not take the drag as a scroll. */
    .angle { width: 152px; height: 152px; touch-action: none; }
    input[type=range]:focus-visible { outline: 2px dashed #fff; outline-offset: 4px; }
    .swatch { width: 28px; height: 28px; padding: 0; border: 1px solid #555; border-radius: 6px; background: none; }
    .swatch::-webkit-color-swatch-wrapper { padding: 0; }
    .swatch::-webkit-color-swatch { border: 0; border-radius: 5px; }
    .read { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); color: #000; }`;

  ready() {
    this.nmRange = this.$('.nm'); this.hueRange = this.$('.hue'); this.angleRange = this.$('.angle');
    this.swatch = this.$('.swatch'); this.read = this.$('.read');
    this.range = this.nmRange;
    const P = PrismPicker, s = P.SLIT;
    // The screen faces the prism: its normal points back along the line from the prism to the slit.
    const back = { x: -Math.cos((s.facing * Math.PI) / 180), y: -Math.sin((s.facing * Math.PI) / 180) };
    this.screen = { p: { x: s.x, y: s.y }, n: back, t: { x: -back.y, y: back.x } };
    this.a = +(this.getAttribute('angle') ?? 20);
    this.colourNm = +(this.getAttribute('wavelength') ?? 459);
    // A wavelength, when one is given, decides the angle: the prism starts turned so that it goes through the slit.
    if (this.hasAttribute('wavelength') || !this.hasAttribute('angle')) this.toWavelength(this.colourNm); else this.fromAngle(this.a);

    this.angleRange.addEventListener('input', () => {
      // While a finger is turning the dial the range still runs its own drag and reports how far across its box
      // the finger is, whatever is cancelled on touchstart. That value is thrown away and the real one put back.
      if (this.grip) { this.angleRange.value = this.a; return; }
      this.fromAngle(+this.angleRange.value); this.changed();
    });
    this.nmRange.addEventListener('input', () => { this.toWavelength(+this.nmRange.value); this.changed(); });
    this.hueRange.addEventListener('input', () => { this.toWavelength(nmOfHue(+this.hueRange.value)); this.changed(); });
    this.swatch.addEventListener('input', () => { this.toWavelength(nmOfHue(rgbToHsb(this.swatch.value)[0])); this.changed(); });

    // Turning by hand. The range is placed over the dial and is what the finger lands on, but a range's own
    // drag reads only how far across it the pointer is, so its default is cancelled and the angle is taken from
    // the direction of the pointer around the centre. The arrow keys are still the range's own.
    const turn = this.angleRange;
    const around = (e) => {
      const r = this.canvas.getBoundingClientRect(), k = P.size[0] / r.width;
      return Math.atan2((e.clientY - r.top) * k - P.C.y, (e.clientX - r.left) * k - P.C.x) * 180 / Math.PI;
    };
    turn.addEventListener('mousedown', (e) => { e.preventDefault(); turn.focus({ preventScroll: true }); });
    turn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    turn.addEventListener('pointerdown', (e) => {
      this.grip = { at: around(e), a: this.a };
      try { turn.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    });
    turn.addEventListener('pointermove', (e) => {
      if (!this.grip) return;
      this.fromAngle(this.grip.a + around(e) - this.grip.at);
      this.changed();
    });
    for (const type of ['pointerup', 'pointercancel']) turn.addEventListener(type, () => { this.grip = null; });
    this.sync();
  }
  changed() { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); }
  get value() { return this.swatch.value; }
  get nm() { return this.colourNm; }
  get angle() { return this.a; }

  // The prism, as a triangle turned by an angle in degrees. It is equilateral, so 120 degrees is a full turn.
  prism(a = this.a) {
    const { C, R } = PrismPicker, t = (a * Math.PI) / 180 - Math.PI / 2;
    return [0, 1, 2].map((i) => ({ x: C.x + Math.cos(t + (i * TAU) / 3) * R, y: C.y + Math.sin(t + (i * TAU) / 3) * R }));
  }
  // Where a ray meets the screen: how far along it, and how far from the slit across it. Null if it never does.
  onScreen(ray) {
    const s = this.screen, den = dot(ray.d, s.n);
    if (den > -1e-6) return null;                               // going away from the face of the screen
    const t = ((s.p.x - ray.p.x) * s.n.x + (s.p.y - ray.p.y) * s.n.y) / den;
    if (t <= 0) return null;
    return { t, u: (ray.p.x + ray.d.x * t - s.p.x) * s.t.x + (ray.p.y + ray.d.y * t - s.p.y) * s.t.y };
  }
  // How far from the slit one wavelength lands with the prism at one angle. NaN when its beam misses the screen.
  miss(a, nm) {
    const light = traceLight(PrismPicker.BEAM, { x: 1, y: 0 }, this.prism(a), indexOf(nm));
    const hit = light?.out[0] && this.onScreen(light.out[0]);
    return hit && Math.abs(hit.u) < PrismPicker.SLIT.half ? hit.u : NaN;
  }
  // At some angles the beam leaves by way of a total reflection inside, which undoes the spreading: it is white,
  // and a white beam on the slit picks no colour. Spread is how far apart the two ends of the spectrum land.
  spread(a) { const d = this.miss(a, 400) - this.miss(a, 680); return d === d ? Math.abs(d) : 0; }
  // The wavelength that goes through the slit with the prism at this angle, or null if none does.
  through(a = this.a) {
    if (this.spread(a) < 1) return null;
    let lo = 380, flo = this.miss(a, lo);
    for (let nm = 390; nm <= 700; nm += 10) {
      const f = this.miss(a, nm);
      if (flo === flo && f === f && flo * f <= 0) {
        let hi = nm;
        for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2, fm = this.miss(a, mid); if (fm * flo <= 0) hi = mid; else { lo = mid; flo = fm; } }
        // A change of sign with no zero under it is the beam jumping from one face to another, not a crossing.
        if (Math.abs(this.miss(a, (lo + hi) / 2)) < 1.5) return (lo + hi) / 2;
      }
      lo = nm; flo = f;
    }
    return null;
  }
  // Set by the angle: the colour follows whatever now goes through the slit.
  fromAngle(a) {
    this.a = ((a % 120) + 120) % 120;
    const nm = this.through();
    this.lit = nm !== null;
    if (this.lit) this.colourNm = nm;
  }
  // Set by the wavelength: find the angles at which it lands on the slit, and turn to the nearest one.
  toWavelength(nm) {
    nm = clamp(nm, 380, 700);
    let best = null, prev = this.miss(0, nm);
    for (let a = 0.25; a <= 120; a += 0.25) {
      const f = this.miss(a, nm);
      if (prev === prev && f === f && prev * f <= 0) {
        let lo = a - 0.25, hi = a, flo = prev;
        for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2, fm = this.miss(mid, nm); if (fm * flo <= 0) hi = mid; else { lo = mid; flo = fm; } }
        const root = (lo + hi) / 2, turn = Math.min(Math.abs(root - this.a), 120 - Math.abs(root - this.a));
        if (Math.abs(this.miss(root, nm)) < 1.5 && this.spread(root) >= 1 && (!best || turn < best.turn)) best = { root, turn };
      }
      prev = f;
    }
    if (!best) return;                                           // no angle sends this wavelength to the slit
    this.a = best.root; this.colourNm = nm; this.lit = true;
  }
  sync() {
    const rgb = wavelengthRGB(this.colourNm);
    this.swatch.value = hex(rgb);
    this.angleRange.value = this.a; this.nmRange.value = Math.round(this.colourNm);
    this.hue = Math.round(rgbToHsb(this.swatch.value)[0]);
    this.hueRange.value = this.hue;
    this.angleRange.setAttribute('aria-valuetext', `${this.a.toFixed(1)} degrees`);
    this.read.textContent = `${Math.round(this.colourNm)} nm, hue ${this.hue} degrees, prism at ${this.a.toFixed(1)} degrees: ${this.swatch.value}`;
    this.setValue(this.swatch.value);
    this.request();
  }

  draw(ctx, w, h) {
    const P = PrismPicker, { C, R, DIAL, BEAM, SCENE } = P, s = this.screen, slit = P.SLIT;
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, w, h);
    const poly = this.prism(), rgb = wavelengthRGB(this.colourNm), d = { x: 1, y: 0 };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, SCENE); ctx.clip();

    // the dial: a tick every 5 degrees, longer at every 30, and a pointer at the corner that started at the top
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(C.x, C.y, DIAL - 16, 0, TAU); ctx.stroke();
    for (let i = 0; i < 72; i++) {
      const t = (i * 5 * Math.PI) / 180, long = i % 6 === 0;
      ctx.strokeStyle = long ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.moveTo(C.x + Math.cos(t) * (DIAL - (long ? 9 : 5)), C.y + Math.sin(t) * (DIAL - (long ? 9 : 5)));
      ctx.lineTo(C.x + Math.cos(t) * DIAL, C.y + Math.sin(t) * DIAL); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.moveTo(C.x - 4, C.y); ctx.lineTo(C.x + 4, C.y); ctx.moveTo(C.x, C.y - 4); ctx.lineTo(C.x, C.y + 4); ctx.stroke();

    // The light. 49 wavelengths, each traced with its own index, drawn additively so that they are white where
    // they run together and colours where the glass has pulled them apart.
    const N = 48, rays = [];
    for (let i = 0; i <= N; i++) {
      const nm = lerp(380, 700, i / N);
      rays.push({ nm, c: wavelengthRGB(nm), light: traceLight(BEAM, d, poly, indexOf(nm)) });
    }
    const far = (ray, len = 520) => ({ x: ray.p.x + ray.d.x * len, y: ray.p.y + ray.d.y * len });
    // A ray that meets the screen stops there, unless it is in the slit.
    const end = (ray) => {
      const on = this.onScreen(ray);
      if (!on || Math.abs(on.u) > slit.half) return far(ray);     // what is in the slit is drawn beyond it, below
      return { x: ray.p.x + ray.d.x * on.t, y: ray.p.y + ray.d.y * on.t };
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const mid = rays[N / 2].light;
    // the beam coming in, with its glow
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(0, BEAM.y); ctx.lineTo(mid ? mid.enter.x : w, BEAM.y); ctx.stroke();
    ctx.shadowBlur = 0;
    if (mid) {
      // the part the first face throws back
      const g = mid.glance, tip = far(g, 260);
      const fade = ctx.createLinearGradient(g.p.x, g.p.y, tip.x, tip.y);
      fade.addColorStop(0, `rgba(255,255,255,${Math.min(0.75, g.w * 4)})`); fade.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = fade; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(g.p.x, g.p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    }
    // inside the glass: every leg of every wavelength. Together they are white, and a little colour shows at
    // the edges of the beam where they have started to part.
    for (const r of rays) {
      if (!r.light) continue;
      for (const leg of r.light.legs) {
        ctx.strokeStyle = `rgba(${r.c[0]},${r.c[1]},${r.c[2]},${Math.min(0.2, 0.14 * leg.w + 0.008)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(leg.a.x, leg.a.y); ctx.lineTo(leg.b.x, leg.b.y); ctx.stroke();
      }
    }
    // what leaves: for each exit, the fan is filled between one wavelength and the next
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < N; i++) {
        const a = rays[i].light?.out[k], b = rays[i + 1].light?.out[k];
        if (!a || !b) continue;
        const ea = k ? far(a, 300) : end(a), eb = k ? far(b, 300) : end(b), c = rays[i].c;
        // A ghost has hardly been spread, so its 48 slices lie on top of each other and each is drawn faint.
        const alpha = k ? Math.min(0.045, (a.w + b.w) * 0.22) : 0.95;
        const fade = ctx.createLinearGradient(a.p.x, a.p.y, ea.x, ea.y);
        fade.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
        fade.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},${k ? 0 : alpha * 0.8})`);
        ctx.fillStyle = fade; ctx.strokeStyle = fade; ctx.lineWidth = 1.1;
        // Two neighbouring wavelengths are only the two edges of one slice of light if they left the glass
        // together: from nearly the same point, in nearly the same direction, and to the same end. Near a corner
        // one can leave by one face and the next by another, or one can stop at the screen and the next miss
        // it, and filling between those paints a sheet of colour across the bench where there is no light.
        const together = dot(a.d, b.d) > 0.99 && Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < 8
          && Math.hypot(ea.x - eb.x, ea.y - eb.y) < 60;
        ctx.beginPath(); ctx.moveTo(a.p.x, a.p.y); ctx.lineTo(ea.x, ea.y);
        if (together) { ctx.lineTo(eb.x, eb.y); ctx.lineTo(b.p.x, b.p.y); ctx.closePath(); ctx.fill(); }
        ctx.stroke();
      }
    }
    // a soft bloom around the beam that leaves
    const main = mid?.out[0];
    if (main) {
      const tip = end(main);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 9; ctx.shadowColor = 'rgba(255,255,255,0.5)'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.moveTo(main.p.x, main.p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // the glass, over the light
    ctx.save();
    ctx.beginPath();
    poly.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    ctx.closePath();
    const g = ctx.createLinearGradient(poly[0].x, poly[0].y, (poly[1].x + poly[2].x) / 2, (poly[1].y + poly[2].y) / 2);
    g.addColorStop(0, 'rgba(226,236,246,0.20)'); g.addColorStop(0.55, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(214,226,238,0.22)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.62)'; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    for (const p of poly) { ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }   // the far edges, seen through it
    ctx.restore();
    // the pointer on the dial
    {
      const t = (this.a * Math.PI) / 180 - Math.PI / 2;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(C.x + Math.cos(t) * (DIAL - 12), C.y + Math.sin(t) * (DIAL - 12)); ctx.lineTo(C.x + Math.cos(t) * (DIAL + 2), C.y + Math.sin(t) * (DIAL + 2)); ctx.stroke();
    }

    // the screen and its slit, and the light that got through
    ctx.strokeStyle = '#8a8f98'; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s.p.x + s.t.x * slit.gap * side, s.p.y + s.t.y * slit.gap * side);
      ctx.lineTo(s.p.x + s.t.x * slit.half * side, s.p.y + s.t.y * slit.half * side); ctx.stroke();
    }
    const spot = { x: s.p.x - s.n.x * 15, y: s.p.y - s.n.y * 15 };
    if (this.lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = `rgb(${rgb.join(',')})`;
      ctx.shadowBlur = 14; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(s.p.x, s.p.y); ctx.lineTo(spot.x, spot.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(spot.x, spot.y, 5.5, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = '#5a5f68'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(spot.x, spot.y, 5.5, 0, TAU); ctx.stroke();
    }
    ctx.restore();                                              // the scene clip

    // The angle range is never painted: it is placed over the dial, which is where it is turned.
    hit(ctx, this.angleRange, C.x - DIAL, C.y - DIAL, DIAL * 2, DIAL * 2);
    if (this.angleRange.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(C.x, C.y, DIAL + 5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }

    // the read-out
    put(ctx, this.swatch, 20, 238);
    ctx.fillStyle = '#f2f3f5'; ctx.font = "600 19px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace";
    ctx.fillText(this.swatch.value.toUpperCase(), 58, 259);
    ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillStyle = this.lit ? '#8d929c' : '#d9a441';
    ctx.fillText(this.lit ? `Prism at ${this.a.toFixed(1)}°` : `No light through the slit at ${this.a.toFixed(1)}°`, 340, 258);
    ctx.textAlign = 'left';

    // the spectrum, with the wavelength range over it
    const bar = { x: 108, y: 282, w: 232, h: 12 };
    for (let i = 0; i < bar.w; i++) {
      const c = wavelengthRGB(lerp(380, 700, i / bar.w));
      ctx.fillStyle = `rgb(${c.join(',')})`;
      ctx.fillRect(bar.x + i, bar.y, 1.2, bar.h);
    }
    hit(ctx, this.nmRange, bar.x - 6, bar.y - 14, bar.w + 12, 40);
    const tx = bar.x + ((this.colourNm - 380) / 320) * bar.w;
    ctx.fillStyle = '#fff';
    rr(ctx, tx - 2, bar.y - 6, 4, bar.h + 12, 2); ctx.fill();
    if (this.nmRange.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(bar.x - 4, bar.y - 9, bar.w + 8, bar.h + 18); ctx.setLineDash([]); }
    // the hue, as a track of the hues a single wavelength can have
    const hy = 312;
    for (let i = 0; i < bar.w; i++) {
      const c = hsbToRgb((i / bar.w) * 280, 100, 100);
      ctx.fillStyle = `rgb(${c.join(',')})`;
      ctx.fillRect(bar.x + i, hy, 1.2, 6);
    }
    hit(ctx, this.hueRange, bar.x - 6, hy - 17, bar.w + 12, 40);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(bar.x + (this.hue / 280) * bar.w, hy + 3, 6.5, 0, TAU); ctx.fill();
    if (this.hueRange.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(bar.x - 4, hy - 8, bar.w + 8, 22); ctx.setLineDash([]); }
    ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#8d929c';
    ctx.fillText(`${Math.round(this.colourNm)} nm`, 20, 293);
    ctx.fillText(`Hue ${this.hue}°`, 20, 320);
    return false;
  }
}
// The wavelength whose colour has the nearest hue. The hues a single wavelength can have run from red, at
// 0 degrees, to violet near 280: there is no wavelength for magenta.
function nmOfHue(hue) {
  let best = 550, gap = 1e9;
  for (let nm = 380; nm <= 700; nm++) {
    const dh = Math.abs(rgbToHsb(hex(wavelengthRGB(nm)))[0] - hue), g = Math.min(dh, 360 - dh);
    if (g < gap) { gap = g; best = nm; }
  }
  return best;
}
customElements.define('prism-picker', PrismPicker);
// #endregion prism-picker
