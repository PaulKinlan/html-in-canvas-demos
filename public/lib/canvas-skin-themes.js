// canvas-skin-themes.js: the six skins that come with <canvas-skin>.
//
// A skin is an object:
//
//   label     the name shown in a menu
//   type      CSS declarations for text: colour, font, colour scheme. Used for the root and for each wrapper
//   root      CSS declarations for the background of the element that carries skin="name"
//   css       nested CSS for a wrapper while it draws (& is the wrapper), for example "& > .primary { color: #000 }"
//   filters   SVG <filter> elements, used as ctx.filter = 'url(#id)'
//   backdrop(ctx, root, region)
//             optional. Draws the root's background in the root's own coordinates, at least over `region`.
//             A skin that shows the background through an element (glass) needs the same picture in the canvas
//   paint(ctx, frame)
//             draws one element. 0, 0 is the element's top left corner and the units are CSS pixels.
//             The canvas has 14 px of room outside the element on every side.
//
//   frame.width, frame.height     the element's size
//   frame.kind                    button | field | check | radio | switch | range | bar | media | text | card
//   frame.el                      the element
//   frame.state                   { checked, on, value, disabled, open, focus, hover, active }
//                                 on is checked eased over a few frames, value is 0..1 for a range, progress or meter
//   frame.primary, frame.heading  the element has class "primary" or type="submit"; it is h1 to h6
//   frame.t                       0..1 over the 640 ms after this element changed skin, 1 at rest
//   frame.time, frame.seed        seconds, and a number that is fixed for this wrapper
//   frame.draw({ x, y, filter, alpha })   draws the element's own picture
//   frame.backdrop(scale, cx, cy)         draws the root's background behind the element, enlarged about cx, cy
//   frame.again = true                    asks for another paint next frame
//
// For the kinds check, radio, switch, range and bar the skins below never call frame.draw(): they draw
// the control from frame.state.

import { glass, GLASS_DEFAULTS } from './glass-gl.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const outCubic = (t) => 1 - (1 - t) ** 3;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2))); };
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); };
const line = (ctx, x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
// Centre of the knob of a range or a switch: the knob is k wide and stays inside the track.
const knobX = (f, v, k = f.height) => k / 2 + v * (f.width - k);
function ring(ctx, f, radius, color, gap = 3, width = 2.5) {
  if (!f.state.focus) return;
  ctx.save();
  rr(ctx, -gap, -gap, f.width + 2 * gap, f.height + 2 * gap, radius + gap);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}
// The arrow of a <select>, which has no drawing of its own once appearance is none.
function chevron(ctx, f, color, width = 2) {
  if (f.el.localName !== 'select') return;
  const x = f.width - 22, y = f.height / 2;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = ctx.lineJoin = 'round'; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x - 6, y - 3); ctx.lineTo(x, y + 3); ctx.lineTo(x + 6, y - 3); ctx.stroke();
  ctx.restore();
}
// A check mark in the square x, y, s, drawn up to the fraction t.
function tick(ctx, x, y, s, t = 1) {
  const a = [x + s * 0.24, y + s * 0.54], b = [x + s * 0.43, y + s * 0.72], c = [x + s * 0.78, y + s * 0.3];
  const t1 = clamp(t * 2.5), t2 = clamp((t - 0.4) / 0.6);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]);
  ctx.lineTo(lerp(a[0], b[0], t1), lerp(a[1], b[1], t1));
  if (t2 > 0) ctx.lineTo(lerp(b[0], c[0], t2), lerp(b[1], c[1], t2));
  ctx.stroke();
}

// ------------------------------------------------------------------------------------------ native
const native = {
  label: 'Browser default',
  type: '', root: '', css: '',
  paint(ctx, f) { f.draw(); },
};

// ------------------------------------------------------------------------------------------- glass
// #region glass
const GLASS_TILE = 640;
const GLASS_PAD = 28;     // how much of the background round the element the shader is given
const GLASS_LINES = 44;   // diagonal lines this far apart. Straight lines show where the glass bends them
// Each blob is listed three times, one tile apart, so the background has no seam where a tile ends.
const GLASS_BLOBS = [
  { x: 0.12, y: 90, r: 270, c: '255 95 162' },
  { x: 0.92, y: 230, r: 290, c: '55 213 255' },
  { x: 0.22, y: 440, r: 270, c: '255 190 70' },
  { x: 0.82, y: 570, r: 250, c: '150 110 255' },
].flatMap((b) => [b, { ...b, y: b.y - GLASS_TILE }, { ...b, y: b.y + GLASS_TILE }]);
const GLASS_TYPE = 'color: #fff; color-scheme: dark; font-family: -apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif;';

// The root background seen through a thick piece of glass with a rounded rim. The flat middle shows
// what is behind it, slightly enlarged. In the rim the surface slopes, so each ring of it shows the
// background from further in, and the outermost ring from furthest: the picture is squeezed toward the
// edge, as at the edge of a lens. The background is drawn once into a shared plain canvas and each
// ring is a drawImage() of that copy, scaled about the centre and clipped to the ring.
const RINGS = 12;
function refract(ctx, f, x, y, w, h, r) {
  const copy = f.backdropCopy(GLASS_PAD);
  if (!copy) return false;
  const cx = x + w / 2, cy = y + h / 2;
  const put = (kx, ky) => {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(kx, ky); ctx.translate(-cx, -cy);
    ctx.drawImage(copy.image, copy.sx, copy.sy, copy.sw, copy.sh, copy.x, copy.y, copy.width, copy.height);
    ctx.restore();
  };
  const rim = Math.min(22, w * 0.3, h * 0.45);          // width of the sloping part
  const bend = Math.min(44, w * 0.4, h * 0.46);         // how far the outermost ring reaches inward, in px
  ctx.save(); ctx.filter = 'blur(0.8px)'; put(1.1, 1.1); ctx.restore();
  for (let i = 0; i < RINGS; i++) {
    const d0 = (rim * i) / RINGS, d1 = (rim * (i + 1)) / RINGS;
    const u = 1 - (d0 + d1) / 2 / rim;                   // 1 at the edge, 0 where the rim meets the flat middle
    const shift = bend * (1 - Math.sqrt(1 - u * u));     // a quarter circle profile: steep at the edge
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + d0, y + d0, w - 2 * d0, h - 2 * d0, Math.max(0, r - d0));
    ctx.roundRect(x + d1 - 0.3, y + d1 - 0.3, w - 2 * d1 + 0.6, h - 2 * d1 + 0.6, Math.max(0, r - d1));
    ctx.clip('evenodd');
    // A point at the edge shows the background `shift` px nearer the centre: the copy is enlarged by that much.
    put(1 / Math.max(0.12, 1 - (2 * shift) / w), 1 / Math.max(0.12, 1 - (2 * shift) / h));
    // The slope also darkens toward the edge at the bottom and catches light at the top.
    ctx.fillStyle = `rgb(255 255 255 / ${0.1 * u})`; ctx.fillRect(x, y, w, h / 2);
    ctx.fillStyle = `rgb(20 0 60 / ${0.16 * u})`; ctx.fillRect(x, y + h / 2, w, h / 2);
    ctx.restore();
  }
  return true;
}

const tintCss = ([r, g, b, a]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;
// A band of light that crosses the element once after a change of skin.
function glassBand(ctx, f, x, y, w, h) {
  if (f.t >= 1) return;
  const bx = lerp(x - 80, x + w + 80, smooth(f.t));
  const band = ctx.createLinearGradient(bx - 60, 0, bx + 60, 0);
  band.addColorStop(0, 'rgb(255 255 255 / 0)'); band.addColorStop(0.5, `rgb(255 255 255 / ${0.6 * (1 - f.t)})`); band.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.transform(1, 0, -0.4, 1, 0, 0);
  ctx.fillStyle = band; ctx.fillRect(x - 200, y, w + 400, h);
}

// One piece of glass. tint is [r, g, b, a] with each from 0 to 1.
function glassPanel(ctx, f, x, y, w, h, r, tint) {
  // The shadow, under an opaque shape that the glass then covers.
  ctx.save();
  ctx.shadowColor = 'rgb(20 0 60 / .4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  rr(ctx, x + 1, y + 1, w - 2, h - 2, r); ctx.fillStyle = '#2a1a5e'; ctx.fill();
  ctx.restore();

  // The shader: the background behind the element goes to the shared WebGL context as a texture, and
  // the refracted, lit result comes back with one drawImage().
  const copy = f.backdropCopy(GLASS_PAD);
  const out = copy && glass(copy.image, copy, { x, y, width: w, height: h, radius: r, tint }, glassSkin.settings, f.scale);
  if (out) {
    ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, x, y, w, h);
    ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip(); glassBand(ctx, f, x, y, w, h); ctx.restore();
    return;
  }

  // No WebGL: the 2D version. Rings for the rim, gradients for the light.
  ctx.save();
  rr(ctx, x, y, w, h, r); ctx.clip();
  if (!refract(ctx, f, x, y, w, h, r)) { ctx.fillStyle = '#5b4a9c'; ctx.fillRect(x, y, w, h); }
  ctx.fillStyle = tintCss([tint[0], tint[1], tint[2], Math.min(1, tint[3] * (glassSkin.settings.tint ?? 1))]); ctx.fillRect(x, y, w, h);
  const shine = ctx.createLinearGradient(0, y, 0, y + h);
  shine.addColorStop(0, 'rgb(255 255 255 / .2)'); shine.addColorStop(0.4, 'rgb(255 255 255 / 0)'); shine.addColorStop(1, 'rgb(255 255 255 / .08)');
  ctx.fillStyle = shine; ctx.fillRect(x, y, w, h);
  glassBand(ctx, f, x, y, w, h);
  ctx.restore();

  rr(ctx, x + 0.6, y + 0.6, w - 1.2, h - 1.2, r);
  const rim = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  rim.addColorStop(0, 'rgb(255 255 255 / .9)'); rim.addColorStop(0.5, 'rgb(255 255 255 / .22)'); rim.addColorStop(1, 'rgb(255 255 255 / .6)');
  ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.stroke();
}
function glassKnob(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = 'rgb(20 0 60 / .45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  circle(ctx, x, y, r); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}

const glassSkin = {
  label: 'Glass',
  // Light angle, rim width, thickness, refractive index, dispersion, frost and highlight strength. See glass-gl.js.
  settings: { ...GLASS_DEFAULTS },
  type: GLASS_TYPE,
  root: `${GLASS_TYPE} background-color: #2a1a5e; background-image: linear-gradient(135deg, rgb(255 255 255 / 0) calc(50% - 1px), rgb(255 255 255 / .2) calc(50% - 1px), rgb(255 255 255 / .2) calc(50% + 1px), rgb(255 255 255 / 0) calc(50% + 1px)), radial-gradient(circle at 11px 11px, rgb(255 255 255 / .3) 1.4px, rgb(255 255 255 / 0) 2px), ${
    GLASS_BLOBS.map((b) => `radial-gradient(circle ${b.r}px at ${b.x * 100}% ${b.y}px, rgb(${b.c} / .85), rgb(${b.c} / 0))`).join(', ')
  }; background-size: ${GLASS_LINES}px ${GLASS_LINES}px, 22px 22px, ${GLASS_BLOBS.map(() => `100% ${GLASS_TILE}px`).join(', ')};`,
  css: 'text-shadow: 0 1px 2px rgb(20 0 60 / .35); caret-color: #fff; & ::placeholder { color: rgb(255 255 255 / .6); }',

  // The same background as the CSS above, for the canvas.
  backdrop(ctx, root, region) {
    ctx.fillStyle = '#2a1a5e';
    ctx.fillRect(region.x, region.y, region.width, region.height);
    const first = Math.floor(region.y / GLASS_TILE), last = Math.floor((region.y + region.height) / GLASS_TILE);
    for (let tile = first; tile <= last; tile++) {
      ctx.save();
      ctx.beginPath(); ctx.rect(region.x, Math.max(region.y, tile * GLASS_TILE), region.width, GLASS_TILE); ctx.clip();
      for (let i = GLASS_BLOBS.length - 1; i >= 0; i--) {
        const b = GLASS_BLOBS[i], cx = b.x * root.width, cy = tile * GLASS_TILE + b.y;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
        g.addColorStop(0, `rgb(${b.c} / .85)`); g.addColorStop(1, `rgb(${b.c} / 0)`);
        ctx.fillStyle = g; ctx.fillRect(region.x, region.y, region.width, region.height);
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgb(255 255 255 / .3)';
    ctx.beginPath();
    for (let y = Math.floor(region.y / 22) * 22 + 11; y < region.y + region.height; y += 22)
      for (let x = Math.floor(region.x / 22) * 22 + 11; x < region.x + region.width; x += 22) { ctx.moveTo(x + 1.7, y); ctx.arc(x, y, 1.7, 0, TAU); }
    ctx.fill();
    // The diagonal lines: x + y is a multiple of GLASS_LINES.
    ctx.save();
    ctx.beginPath(); ctx.rect(region.x, region.y, region.width, region.height); ctx.clip();
    ctx.strokeStyle = 'rgb(255 255 255 / .2)'; ctx.lineWidth = 2;
    ctx.beginPath();
    const from = Math.floor((region.x + region.y) / GLASS_LINES), to = Math.ceil((region.x + region.width + region.y + region.height) / GLASS_LINES);
    for (let n = from; n <= to; n++) { const c = n * GLASS_LINES; ctx.moveTo(c - region.y + 2, region.y - 2); ctx.lineTo(c - region.y - region.height - 2, region.y + region.height + 2); }
    ctx.stroke();
    ctx.restore();
  },

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    if (f.t < 1 && kind !== 'text') { const k = lerp(0.94, 1, outCubic(f.t)); ctx.translate(w / 2, h / 2); ctx.scale(k, k); ctx.translate(-w / 2, -h / 2); }
    switch (kind) {
      case 'button':
        glassPanel(ctx, f, 0, 0, w, h, h / 2, s.active ? [1, 1, 1, 0.34] : f.primary ? [0.24, 0.55, 1, 0.42] : [1, 1, 1, 0.08]);
        f.draw(); ring(ctx, f, h / 2, '#fff'); break;
      case 'field':
        glassPanel(ctx, f, 0, 0, w, h, 16, [0.08, 0, 0.24, 0.14]);
        f.draw(); chevron(ctx, f, '#fff'); ring(ctx, f, 16, '#fff', 0, 2); break;
      case 'card':
        glassPanel(ctx, f, 0, 0, w, h, 24, [1, 1, 1, 0.05]);
        f.draw(); break;
      case 'media':
        ctx.save(); rr(ctx, 0, 0, w, h, 18); ctx.clip(); f.draw(); ctx.restore();
        rr(ctx, 0.6, 0.6, w - 1.2, h - 1.2, 18); ctx.strokeStyle = 'rgb(255 255 255 / .7)'; ctx.lineWidth = 1.2; ctx.stroke(); break;
      case 'check':
        glassPanel(ctx, f, 0, 0, w, h, 9, [1, 1, 1, 0.14 + 0.7 * s.on]);
        ctx.strokeStyle = '#2a1a5e'; ctx.lineWidth = 3; ctx.lineCap = ctx.lineJoin = 'round'; if (s.on > 0.05) tick(ctx, 0, 0, h, s.on);
        ring(ctx, f, 9, '#fff'); break;
      case 'radio':
        glassPanel(ctx, f, 0, 0, w, h, h / 2, [1, 1, 1, 0.14]);
        circle(ctx, w / 2, h / 2, h * 0.24 * s.on); ctx.fillStyle = '#fff'; ctx.fill();
        ring(ctx, f, h / 2, '#fff'); break;
      case 'switch':
        glassPanel(ctx, f, 0, 0, w, h, h / 2, [0.2, 0.78, 0.35, 0.9 * s.on]);
        glassKnob(ctx, knobX(f, s.on), h / 2, h / 2 - 3);
        ring(ctx, f, h / 2, '#fff'); break;
      case 'range': {
        const x = knobX(f, s.value);
        glassPanel(ctx, f, 0, h / 2 - 4, w, 8, 4, [0.08, 0, 0.24, 0.2]);
        rr(ctx, 0, h / 2 - 4, x, 8, 4); ctx.fillStyle = 'rgb(255 255 255 / .9)'; ctx.fill();
        glassKnob(ctx, x, h / 2, h / 2 - (s.active ? 0 : 2));
        ring(ctx, f, h / 2, '#fff'); break;
      }
      case 'bar':
        glassPanel(ctx, f, 0, 0, w, h, h / 2, [0.08, 0, 0.24, 0.2]);
        rr(ctx, 2, 2, (w - 4) * s.value, h - 4, h / 2); ctx.fillStyle = 'rgb(255 255 255 / .92)'; ctx.fill(); break;
      default: f.draw();
    }
  },
};
// #endregion glass

// ------------------------------------------------------------------------------------------ pencil
// #region pencil
const GRAPHITE = '#2b2b33', BLUE_PENCIL = '#2456c9';
const PENCIL_TYPE = `color: ${GRAPHITE}; color-scheme: light; font-family: "Coming Soon", "Comic Neue", "Chalkboard SE", "Bradley Hand", "Segoe Print", "Comic Sans MS", casual, cursive;`;

// A line through the points, each moved a little, drawn up to the fraction t.
function sketch(ctx, rand, pts, { jitter = 1.2, t = 1 } = {}) {
  const upto = Math.max(2, Math.ceil(pts.length * t));
  ctx.beginPath();
  let px = 0, py = 0;
  for (let i = 0; i < upto && i < pts.length; i++) {
    const x = pts[i][0] + (rand() - 0.5) * 2 * jitter, y = pts[i][1] + (rand() - 0.5) * 2 * jitter;
    if (i === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    px = x; py = y;
  }
  ctx.lineTo(px, py);
  ctx.stroke();
}
const along = (x1, y1, x2, y2, step = 18) => {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
  return Array.from({ length: n + 1 }, (_, i) => [lerp(x1, x2, i / n), lerp(y1, y2, i / n)]);
};
// Four separate strokes that overshoot the corners, one after another as t goes from 0 to 1.
function roughRect(ctx, rand, x, y, w, h, t = 1, over = 3) {
  const sides = [[x - over, y, x + w + over, y], [x + w, y - over, x + w, y + h + over], [x + w + over, y + h, x - over, y + h], [x, y + h + over, x, y - over]];
  sides.forEach((s, i) => { const part = clamp(t * 4 - i); if (part > 0) sketch(ctx, rand, along(...s), { t: part }); });
}
function roughOval(ctx, rand, cx, cy, rx, ry, t = 1) {
  const n = 16, start = rand() * TAU;
  // A little more than one turn, so the ends cross as they do when drawn by hand.
  sketch(ctx, rand, Array.from({ length: n + 3 }, (_, i) => { const a = start + (i / n) * TAU; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; }), { jitter: 0.9, t });
}
function roughPill(ctx, rand, x, y, w, h, t = 1) {
  const r = h / 2, pts = [...along(x + r, y, x + w - r, y)];
  for (let i = 1; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; pts.push([x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r]); }
  pts.push(...along(x + w - r, y + h, x + r, y + h));
  for (let i = 1; i < 6; i++) { const a = Math.PI / 2 + (i / 6) * Math.PI; pts.push([x + r + Math.cos(a) * r, y + r + Math.sin(a) * r]); }
  pts.push([x + r, y], [x + r + 8, y]);
  sketch(ctx, rand, pts, { jitter: 0.9, t });
}
// Diagonal lines across a rectangle, as many as the fraction t.
function hatch(ctx, rand, x, y, w, h, gap, t = 1, dir = 1) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const n = Math.ceil((w + h) / gap) * t;
  for (let i = 0; i < n; i++) {
    const x0 = x + i * gap + (rand() - 0.5) * 2;
    ctx.beginPath();
    if (dir > 0) { ctx.moveTo(x0, y - 1); ctx.lineTo(x0 - h - 2 + (rand() - 0.5) * 3, y + h + 1); }
    else { ctx.moveTo(x0 - h, y - 1); ctx.lineTo(x0 + 2 + (rand() - 0.5) * 3, y + h + 1); }
    ctx.stroke();
  }
  ctx.restore();
}
function scribble(ctx, rand, cx, cy, r, amount) {
  if (amount <= 0.02) return;
  ctx.save(); circle(ctx, cx, cy, r); ctx.clip();
  const pts = [];
  for (let x = -r; x <= r; x += 2.6) pts.push([cx + x, cy + (pts.length % 2 ? r : -r) * 1.1]);
  sketch(ctx, rand, pts, { jitter: 0.6, t: amount });
  ctx.restore();
}

const pencil = {
  label: 'Pencil',
  type: PENCIL_TYPE,
  root: `${PENCIL_TYPE} background-color: #fbf6e6; background-image: repeating-linear-gradient(rgb(120 160 210 / 0) 0 31px, rgb(120 160 210 / .38) 31px 32px);`,
  css: `caret-color: ${BLUE_PENCIL}; & ::placeholder { color: rgb(43 43 51 / .5); }`,
  filters: `
    <filter id="pencil-wobble" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="pencil-sketch" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="grey"/>
      <feConvolveMatrix in="grey" order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edge"/>
      <feColorMatrix in="edge" type="matrix" values="0 0 0 0 .17  0 0 0 0 .17  0 0 0 0 .2  4 4 4 0 0" result="lines"/>
      <feMorphology in="lines" operator="dilate" radius="0.6" result="thick"/>
      <feColorMatrix in="SourceGraphic" type="matrix" values=".5 0 0 0 .45  0 .5 0 0 .44  0 0 .5 0 .4  0 0 0 .55 0" result="wash"/>
      <feMerge result="both"><feMergeNode in="wash"/><feMergeNode in="thick"/></feMerge>
      <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="9" result="n"/>
      <feDisplacementMap in="both" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    // The lines are drawn again with new offsets nine times a second while the element is changing
    // skin, pressed, or under a mouse. At rest they are fixed.
    const moving = f.t < 1 || s.hover || s.active;
    if (moving) f.again = true;
    const rand = rng(f.seed + (moving ? Math.floor(f.time * 9) * 131 : 0));
    const t = smooth(f.t);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = GRAPHITE; ctx.lineWidth = 1.3; ctx.globalAlpha *= 0.9;
    const wobble = 'url(#pencil-wobble)';
    const focus = (shape) => { if (s.focus) { ctx.save(); ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 2; shape(); ctx.restore(); } };

    switch (kind) {
      case 'button':
        ctx.save();
        ctx.strokeStyle = f.primary ? BLUE_PENCIL : GRAPHITE; ctx.lineWidth = 1; ctx.globalAlpha *= f.primary ? 0.55 : 0.28;
        hatch(ctx, rand, 2, 2, w - 4, h - 4, f.primary ? 5 : 7, t);
        if (s.active) hatch(ctx, rand, 2, 2, w - 4, h - 4, 6, 1, -1);
        ctx.restore();
        roughRect(ctx, rand, 0, 0, w, h, t); roughRect(ctx, rand, 0.5, 1, w, h, t);
        focus(() => roughRect(ctx, rand, -3, -3, w + 6, h + 6));
        f.draw({ filter: wobble }); break;
      case 'field':
        ctx.save(); ctx.globalAlpha *= 0.5; roughRect(ctx, rand, 0, 0, w, h, t, 1); ctx.restore();
        ctx.lineWidth = 1.8; sketch(ctx, rand, along(-3, h, w + 3, h), { t });
        focus(() => roughRect(ctx, rand, -2, -2, w + 4, h + 4));
        chevron(ctx, f, GRAPHITE, 1.6);
        f.draw({ filter: wobble }); break;
      case 'card':
        roughRect(ctx, rand, 0, 0, w, h, t); roughRect(ctx, rand, 1, 0.5, w, h, t);
        f.draw({ filter: wobble }); break;
      case 'media':
        f.draw({ filter: 'url(#pencil-sketch)' });
        roughRect(ctx, rand, 0, 0, w, h, t); roughRect(ctx, rand, 1, 1, w, h, t); break;
      case 'check':
        roughRect(ctx, rand, 2, 2, w - 4, h - 4, t, 2);
        if (s.on > 0.05) { ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 3; tick(ctx, -1, -3, h + 4, s.on); }
        focus(() => roughRect(ctx, rand, -2, -2, w + 4, h + 4)); break;
      case 'radio':
        roughOval(ctx, rand, w / 2, h / 2, w / 2 - 2, h / 2 - 2, t);
        ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 2; scribble(ctx, rand, w / 2, h / 2, h * 0.27, s.on);
        focus(() => roughOval(ctx, rand, w / 2, h / 2, w / 2 + 2, h / 2 + 2)); break;
      case 'switch': {
        const x = knobX(f, s.on);
        roughPill(ctx, rand, 1, 3, w - 2, h - 6, t);
        roughOval(ctx, rand, x, h / 2, h / 2 - 1, h / 2 - 1, t);
        ctx.save(); circle(ctx, x, h / 2, h / 2 - 1.5); ctx.fillStyle = '#fbf6e6'; ctx.globalAlpha = 1; ctx.fill(); ctx.restore();
        roughOval(ctx, rand, x, h / 2, h / 2 - 1, h / 2 - 1);
        ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 2; scribble(ctx, rand, x, h / 2, h / 2 - 3, s.on);
        focus(() => roughPill(ctx, rand, -2, 0, w + 4, h)); break;
      }
      case 'range': {
        const x = knobX(f, s.value);
        sketch(ctx, rand, along(0, h / 2, w, h / 2, 14), { t });
        ctx.save(); ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 3; sketch(ctx, rand, along(0, h / 2, x, h / 2, 14)); ctx.restore();
        ctx.save(); circle(ctx, x, h / 2, h / 2 - 2); ctx.fillStyle = '#fbf6e6'; ctx.globalAlpha = 1; ctx.fill(); ctx.restore();
        roughOval(ctx, rand, x, h / 2, h / 2 - 2, h / 2 - 2);
        ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 1.6; scribble(ctx, rand, x, h / 2, h / 2 - 4, s.active ? 1 : 0.55);
        focus(() => roughOval(ctx, rand, x, h / 2, h / 2 + 2, h / 2 + 2)); break;
      }
      case 'bar':
        ctx.save(); ctx.strokeStyle = BLUE_PENCIL; ctx.lineWidth = 1.4; hatch(ctx, rand, 1, 1, (w - 2) * s.value, h - 2, 4, t); ctx.restore();
        roughRect(ctx, rand, 0, 0, w, h, t, 2); break;
      default:
        f.draw({ filter: wobble });
        if (f.heading) { ctx.lineWidth = 1.6; sketch(ctx, rand, along(0, h + 1, w * 0.72, h + 2), { t }); sketch(ctx, rand, along(4, h + 5, w * 0.5, h + 4), { t }); }
    }
  },
};
// #endregion pencil

// --------------------------------------------------------------------------------------------- gel
// #region gel
const GEL_TYPE = 'color: #16181d; color-scheme: light; font-family: "Lucida Grande", "Lucida Sans Unicode", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;';
const GEL_BLUE = { top: '#9bd6ff', mid: '#1b6fe6', low: '#86dcff', edge: '#0b3f9c', shade: 'rgb(11 63 156 / .5)' };
const GEL_CLEAR = { top: '#ffffff', mid: '#cbd3de', low: '#f7fafc', edge: '#6f7a88', shade: 'rgb(60 70 85 / .4)' };

// A glossy body: a three stop gradient, a dark edge, a white highlight in the top half and a glow at the bottom.
function gelBody(ctx, x, y, w, h, r, c, pressed = false) {
  ctx.save();
  ctx.shadowColor = c.shade; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c.top); g.addColorStop(0.5, c.mid); g.addColorStop(1, c.low);
  rr(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, x, y, w, h, r); ctx.clip();
  const glow = ctx.createRadialGradient(x + w / 2, y + h * 1.1, 0, x + w / 2, y + h * 1.1, Math.max(w * 0.6, h));
  glow.addColorStop(0, 'rgb(255 255 255 / .55)'); glow.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = glow; ctx.fillRect(x, y, w, h);
  if (pressed) { ctx.fillStyle = 'rgb(0 20 70 / .22)'; ctx.fillRect(x, y, w, h); }
  ctx.restore();
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.stroke();
  const inset = Math.min(r * 0.45, w * 0.2), hh = h * 0.46;
  const shine = ctx.createLinearGradient(0, y + 1.5, 0, y + 1.5 + hh);
  shine.addColorStop(0, 'rgb(255 255 255 / .92)'); shine.addColorStop(1, 'rgb(255 255 255 / .12)');
  rr(ctx, x + inset, y + 1.5, w - 2 * inset, hh, hh / 2); ctx.fillStyle = shine; ctx.fill();
}
// A track that is cut into the page: darker at the top, with a light line under it.
function gelWell(ctx, x, y, w, h, r) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#aeb6c2'); g.addColorStop(0.35, '#e3e8ee'); g.addColorStop(1, '#ffffff');
  rr(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#7b8594'; ctx.lineWidth = 1; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
}
function gelFocus(ctx, f, r) {
  if (!f.state.focus) return;
  ctx.save(); ctx.shadowColor = '#3b99fc'; ctx.shadowBlur = 8;
  rr(ctx, -1.5, -1.5, f.width + 3, f.height + 3, r + 1.5); ctx.strokeStyle = 'rgb(59 153 252 / .9)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

const gel = {
  label: 'Gel',
  type: GEL_TYPE,
  root: `${GEL_TYPE} background-color: #e6eaf0; background-image: repeating-linear-gradient(0deg, rgb(255 255 255 / .7) 0 2px, rgb(255 255 255 / 0) 2px 4px);`,
  css: 'text-shadow: 0 1px 0 rgb(255 255 255 / .7); & ::placeholder { color: #8a93a0; } &[kind="field"] > * { text-shadow: none; }',

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    if (f.t < 1 && kind !== 'text' && kind !== 'card') {
      // Squash and stretch that dies away, as a drop of gel would settle.
      const e = Math.sin(f.t * TAU * 1.5) * (1 - f.t) ** 2 * 0.16, k = lerp(0.8, 1, outCubic(clamp(f.t * 3)));
      ctx.translate(w / 2, h / 2); ctx.scale(k * (1 + e), k * (1 - e)); ctx.translate(-w / 2, -h / 2);
    }
    switch (kind) {
      case 'button':
        gelBody(ctx, 0, 0, w, h, h / 2, f.primary ? GEL_BLUE : GEL_CLEAR, s.active);
        f.draw(); gelFocus(ctx, f, h / 2); break;
      case 'field': {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#d5dae1'); g.addColorStop(Math.min(0.5, 7 / h), '#ffffff'); g.addColorStop(1, '#ffffff');
        rr(ctx, 0, 0, w, h, 7); ctx.fillStyle = g; ctx.fill();
        rr(ctx, 0.5, 0.5, w - 1, h - 1, 7); ctx.strokeStyle = '#7b8594'; ctx.lineWidth = 1; ctx.stroke();
        if (f.el.localName === 'select') {
          // The blue cap with two arrows that pop-up menus had.
          ctx.save(); rr(ctx, 0, 0, w, h, 7); ctx.clip(); gelBody(ctx, w - 34, -2, 40, h + 4, 0, GEL_BLUE); ctx.restore();
          ctx.fillStyle = '#0a1c44';
          ctx.beginPath(); ctx.moveTo(w - 22, h / 2 - 4); ctx.lineTo(w - 17, h / 2 - 11); ctx.lineTo(w - 12, h / 2 - 4); ctx.fill();
          ctx.beginPath(); ctx.moveTo(w - 22, h / 2 + 4); ctx.lineTo(w - 17, h / 2 + 11); ctx.lineTo(w - 12, h / 2 + 4); ctx.fill();
        }
        f.draw(); gelFocus(ctx, f, 7); break;
      }
      case 'card':
        ctx.save(); ctx.shadowColor = 'rgb(40 50 70 / .3)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
        rr(ctx, 0, 0, w, h, 12); ctx.fillStyle = 'rgb(255 255 255 / .92)'; ctx.fill(); ctx.restore();
        rr(ctx, 0.5, 0.5, w - 1, h - 1, 12); ctx.strokeStyle = '#a3acb9'; ctx.lineWidth = 1; ctx.stroke();
        f.draw(); break;
      case 'media': {
        ctx.save(); ctx.shadowColor = 'rgb(40 50 70 / .4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        rr(ctx, 0, 0, w, h, 16); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        ctx.save(); rr(ctx, 0, 0, w, h, 16); ctx.clip(); f.draw();
        // The curved reflection that icons of the time had over their top half.
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.3); ctx.quadraticCurveTo(w / 2, h * 0.62, 0, h * 0.42); ctx.closePath();
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
        g.addColorStop(0, 'rgb(255 255 255 / .6)'); g.addColorStop(1, 'rgb(255 255 255 / .08)');
        ctx.fillStyle = g; ctx.fill(); ctx.restore();
        rr(ctx, 0.5, 0.5, w - 1, h - 1, 16); ctx.strokeStyle = 'rgb(40 50 70 / .5)'; ctx.lineWidth = 1; ctx.stroke(); break;
      }
      case 'check':
        gelBody(ctx, 2, 2, w - 4, h - 4, 7, s.on > 0.5 ? GEL_BLUE : GEL_CLEAR, s.active);
        ctx.lineCap = ctx.lineJoin = 'round';
        if (s.on > 0.05) { ctx.strokeStyle = 'rgb(255 255 255 / .8)'; ctx.lineWidth = 4.5; tick(ctx, 1, 0, h, s.on); ctx.strokeStyle = '#0a1c44'; ctx.lineWidth = 2.8; tick(ctx, 1, -1, h, s.on); }
        gelFocus(ctx, f, 8); break;
      case 'radio':
        gelBody(ctx, 2, 2, w - 4, h - 4, h / 2, s.on > 0.5 ? GEL_BLUE : GEL_CLEAR, s.active);
        circle(ctx, w / 2, h / 2 + 0.5, h * 0.17 * s.on); ctx.fillStyle = '#0a1c44'; ctx.fill();
        gelFocus(ctx, f, h / 2); break;
      case 'switch':
        gelWell(ctx, 0, 3, w, h - 6, h / 2);
        ctx.save(); ctx.globalAlpha *= s.on; rr(ctx, 1, 4, w - 2, h - 8, h / 2); ctx.fillStyle = '#6db7ff'; ctx.fill(); ctx.restore();
        gelBody(ctx, knobX(f, s.on) - h / 2 + 1, 1, h - 2, h - 2, h / 2, GEL_BLUE, s.active);
        gelFocus(ctx, f, h / 2); break;
      case 'range': {
        const x = knobX(f, s.value);
        gelWell(ctx, 0, h / 2 - 5, w, 10, 5);
        rr(ctx, 1, h / 2 - 4, Math.max(0, x - 1), 8, 4); ctx.fillStyle = '#6db7ff'; ctx.fill();
        gelBody(ctx, x - h / 2 + 1, 1, h - 2, h - 2, h / 2, GEL_BLUE, s.active);
        gelFocus(ctx, f, h / 2); break;
      }
      case 'bar': {
        gelWell(ctx, 0, 0, w, h, h / 2);
        const fw = Math.max(h, (w - 2) * s.value);
        if (s.value > 0) {
          ctx.save(); rr(ctx, 1, 1, fw, h - 2, h / 2); ctx.clip();
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, '#9bd6ff'); g.addColorStop(0.5, '#1b6fe6'); g.addColorStop(1, '#86dcff');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          // Slanted lighter stripes. They move while the element changes skin.
          ctx.fillStyle = 'rgb(255 255 255 / .2)';
          const shift = (1 - f.t) * 60;
          for (let x = -h * 2 + (shift % 16); x < fw + h; x += 16) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.lineTo(x + h + 8, 0); ctx.lineTo(x + 8, h); ctx.fill(); }
          ctx.fillStyle = 'rgb(255 255 255 / .5)'; rr(ctx, 4, 2, fw - 6, h * 0.36, h); ctx.fill();
          ctx.restore();
        }
        break;
      }
      default: f.draw();
    }
  },
};
// #endregion gel

// ---------------------------------------------------------------------------------------- terminal
// #region terminal
const PHOSPHOR = '#5dff8f', TERM_BG = '#03120a';
const TERM_TYPE = `color: ${PHOSPHOR}; color-scheme: dark; font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;`;
const termBox = (ctx, x, y, w, h) => ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);

const terminal = {
  label: 'Terminal',
  type: TERM_TYPE,
  root: `${TERM_TYPE} background-color: ${TERM_BG}; background-image: repeating-linear-gradient(0deg, rgb(93 255 143 / .08) 0 1px, rgb(93 255 143 / 0) 1px 3px);`,
  css: `caret-color: ${PHOSPHOR}; & ::placeholder { color: rgb(93 255 143 / .5); } &[kind="field"] > * { padding-left: 34px; } &[kind="button"] > .primary { color: ${TERM_BG}; } & ::selection { background: ${PHOSPHOR}; color: ${TERM_BG}; }`,
  filters: `
    <filter id="term-glow" x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="term-mono" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values=".3 .59 .11 0 0  .3 .59 .11 0 0  .3 .59 .11 0 0  0 0 0 1 0"/>
      <feComponentTransfer><feFuncR type="discrete" tableValues="0 .05 .12 .3"/><feFuncG type="discrete" tableValues="0.06 .3 .6 .95"/><feFuncB type="discrete" tableValues="0.03 .1 .22 .5"/></feComponentTransfer>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s, bleed: b } = f;
    const glow = 'url(#term-glow)';
    if (f.t < 1) {
      // The element appears from left to right behind a block cursor.
      const edge = lerp(-b, w + b, f.t);
      ctx.fillStyle = PHOSPHOR; ctx.fillRect(edge, 0, 9, h);
      ctx.beginPath(); ctx.rect(-b, -b, edge + b, h + 2 * b); ctx.clip();
    }
    ctx.strokeStyle = ctx.fillStyle = PHOSPHOR; ctx.lineWidth = 1;
    ctx.shadowColor = PHOSPHOR; ctx.shadowBlur = 6;
    const focus = () => { if (s.focus) { ctx.save(); ctx.setLineDash([6, 4]); termBox(ctx, -4, -4, w + 8, h + 8); ctx.restore(); } };

    switch (kind) {
      case 'button':
        if (f.primary || s.active) { ctx.save(); ctx.globalAlpha *= f.primary ? (s.active ? 0.7 : 1) : 0.35; ctx.fillRect(0, 0, w, h); ctx.restore(); }
        // Square brackets at the two ends.
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(1, 1); ctx.lineTo(1, h - 1); ctx.lineTo(8, h - 1);
        ctx.moveTo(w - 8, 1); ctx.lineTo(w - 1, 1); ctx.lineTo(w - 1, h - 1); ctx.lineTo(w - 8, h - 1); ctx.stroke();
        ctx.shadowBlur = 0; f.draw(f.primary ? {} : { filter: glow }); ctx.shadowBlur = 6; focus(); break;
      case 'field':
        ctx.fillRect(0, h - 2, w, 2);
        ctx.lineWidth = 2; ctx.lineCap = ctx.lineJoin = 'miter';
        ctx.beginPath(); ctx.moveTo(12, 16); ctx.lineTo(19, 22); ctx.lineTo(12, 28); ctx.stroke();
        chevron(ctx, f, PHOSPHOR);
        if (s.focus) { ctx.lineWidth = 1; termBox(ctx, 0, 0, w, h); }
        ctx.shadowBlur = 0; f.draw({ filter: glow }); break;
      case 'card':
        termBox(ctx, 0, 0, w, h); termBox(ctx, 3, 3, w - 6, h - 6);
        ctx.shadowBlur = 0; f.draw({ filter: glow }); break;
      case 'media':
        ctx.shadowBlur = 0; f.draw({ filter: 'url(#term-mono)' });
        ctx.save(); ctx.fillStyle = 'rgb(3 18 10 / .45)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1); ctx.restore();
        ctx.shadowBlur = 6; termBox(ctx, 0, 0, w, h); break;
      case 'check':
        ctx.lineWidth = 2; termBox(ctx, 3, 3, w - 6, h - 6);
        if (s.on > 0.05) { ctx.lineWidth = 3; const m = 9, e = lerp(m, w - m, s.on); line(ctx, m, m, e, e); line(ctx, w - m, m, w - e, e); }
        focus(); break;
      case 'radio':
        ctx.lineWidth = 2; circle(ctx, w / 2, h / 2, h / 2 - 3); ctx.stroke();
        circle(ctx, w / 2, h / 2, (h / 2 - 8) * s.on); ctx.fill(); focus(); break;
      case 'switch':
        ctx.lineWidth = 2; termBox(ctx, 1, 3, w - 2, h - 6);
        ctx.save(); ctx.globalAlpha *= 0.3 + 0.7 * s.on; ctx.fillRect(lerp(5, w / 2 + 1, s.on), 7, w / 2 - 6, h - 14); ctx.restore(); focus(); break;
      case 'range': {
        const x = knobX(f, s.value, 12);
        ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; line(ctx, 0, h / 2, w, h / 2); ctx.restore();
        ctx.fillRect(0, h / 2 - 2, x, 4);
        ctx.fillRect(x - 6, 2, 12, h - 4); focus(); break;
      }
      case 'bar': {
        // Sixteen blocks, lit up to the value.
        const n = 16, gap = 3, bw = (w - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) { ctx.save(); ctx.globalAlpha *= (i + 0.5) / n <= s.value ? 1 : 0.18; ctx.fillRect(i * (bw + gap), 0, bw, h); ctx.restore(); }
        break;
      }
      default: ctx.shadowBlur = 0; f.draw({ filter: glow });
    }
  },
};
// #endregion terminal

// --------------------------------------------------------------------------------------- blueprint
// #region blueprint
const CHALK = '#eaf2ff', BP_MARK = '#ffd84d';
const BP_TYPE = `color: ${CHALK}; color-scheme: dark; font-family: "Courier New", "Courier Prime", ui-monospace, monospace;`;

// An outline with construction lines past each corner and the size written above it.
function bpFrame(ctx, f, x, y, w, h, { label = true, t = 1 } = {}) {
  const e = 8 * t;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeRect(x + 0.5, y + 0.5, (w - 1) * t, (h - 1) * t);
  ctx.globalAlpha *= 0.6; ctx.lineWidth = 0.8;
  for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x + w, y + h, 1, 1], [x, y + h, -1, 1]]) { line(ctx, cx, cy, cx + dx * e, cy); line(ctx, cx, cy, cx, cy + dy * e); }
  if (label && w > 70) {
    const text = `${Math.round(w * t)} × ${Math.round(h * t)}`;
    ctx.globalAlpha = 1; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = '#17479e'; ctx.fillRect(x + w - tw - 16, y - 5, tw + 6, 10);
    ctx.fillStyle = CHALK; ctx.fillText(text, x + w - 13, y + 0.5);
  }
  ctx.restore();
}

const blueprint = {
  label: 'Blueprint',
  type: BP_TYPE,
  root: `${BP_TYPE} background-color: #17479e; background-image: linear-gradient(rgb(255 255 255 / .2) 1px, rgb(255 255 255 / 0) 1px), linear-gradient(90deg, rgb(255 255 255 / .2) 1px, rgb(255 255 255 / 0) 1px), linear-gradient(rgb(255 255 255 / .08) 1px, rgb(255 255 255 / 0) 1px), linear-gradient(90deg, rgb(255 255 255 / .08) 1px, rgb(255 255 255 / 0) 1px); background-size: 100px 100px, 100px 100px, 20px 20px, 20px 20px;`,
  css: `caret-color: ${BP_MARK}; & ::placeholder { color: rgb(234 242 255 / .55); }`,
  filters: `
    <filter id="bp-lines" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="grey"/>
      <feConvolveMatrix in="grey" order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edge"/>
      <feColorMatrix in="edge" type="matrix" values="0 0 0 0 .92  0 0 0 0 .95  0 0 0 0 1  4 4 4 0 0" result="lines"/>
      <feMorphology in="lines" operator="dilate" radius="0.5"/>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const t = outCubic(f.t);
    ctx.strokeStyle = ctx.fillStyle = CHALK; ctx.lineWidth = 1.2;
    const rand = rng(f.seed);
    const focus = () => { if (s.focus) { ctx.save(); ctx.strokeStyle = BP_MARK; ctx.lineWidth = 2; ctx.strokeRect(-3, -3, w + 6, h + 6); ctx.restore(); } };
    const lines = (x, y, ww, hh, gap) => { ctx.save(); ctx.globalAlpha *= 0.4; ctx.lineWidth = 0.8; hatch(ctx, rand, x, y, ww, hh, gap, t); ctx.restore(); };

    switch (kind) {
      case 'button':
        if (f.primary || s.active) { ctx.save(); ctx.globalAlpha *= s.active ? 0.4 : 0.2; ctx.fillRect(0, 0, w, h); ctx.restore(); }
        lines(0, 0, w, h, f.primary ? 6 : 12);
        bpFrame(ctx, f, 0, 0, w, h, { t }); f.draw(); focus(); break;
      case 'field':
        ctx.save(); ctx.setLineDash([5, 3]); ctx.globalAlpha *= 0.7; line(ctx, 8, h - 9, 8 + (w - 16) * t, h - 9); ctx.restore();
        bpFrame(ctx, f, 0, 0, w, h, { t }); chevron(ctx, f, CHALK, 1.4); f.draw(); focus(); break;
      case 'card':
        bpFrame(ctx, f, 0, 0, w, h, { t }); f.draw(); break;
      case 'media':
        f.draw({ filter: 'url(#bp-lines)' }); bpFrame(ctx, f, 0, 0, w, h, { t }); break;
      case 'check':
        bpFrame(ctx, f, 3, 3, w - 6, h - 6, { label: false, t });
        if (s.on > 0.05) { const m = 3, e = lerp(m, w - m, s.on); ctx.lineWidth = 2; line(ctx, m, m, e, e); line(ctx, w - m, m, w - e, e); }
        focus(); break;
      case 'radio':
        circle(ctx, w / 2, h / 2, (h / 2 - 3) * t); ctx.stroke();
        ctx.save(); ctx.globalAlpha *= 0.6; ctx.lineWidth = 0.8; line(ctx, -4, h / 2, w + 4, h / 2); line(ctx, w / 2, -4, w / 2, h + 4); ctx.restore();
        circle(ctx, w / 2, h / 2, (h / 2 - 8) * s.on); ctx.fill(); focus(); break;
      case 'switch': {
        const x = knobX(f, s.on);
        rr(ctx, 0.5, 3.5, w - 1, h - 7, h / 2); ctx.stroke();
        ctx.save(); circle(ctx, x, h / 2, h / 2 - 1); ctx.fillStyle = '#17479e'; ctx.fill(); ctx.stroke();
        ctx.globalAlpha *= s.on; circle(ctx, x, h / 2, h / 2 - 5); ctx.fillStyle = CHALK; ctx.fill(); ctx.restore();
        ctx.save(); ctx.globalAlpha *= 0.6; ctx.lineWidth = 0.8; line(ctx, x, -4, x, h + 4); ctx.restore(); focus(); break;
      }
      case 'range': {
        const x = knobX(f, s.value);
        line(ctx, 0, h / 2, w * t, h / 2);
        ctx.save(); ctx.globalAlpha *= 0.7; ctx.lineWidth = 0.8; for (let i = 0; i <= 10; i++) { const tx = knobX(f, i / 10); line(ctx, tx, h / 2 - (i % 5 ? 4 : 7), tx, h / 2 + (i % 5 ? 4 : 7)); } ctx.restore();
        circle(ctx, x, h / 2, h / 2 - 2); ctx.save(); ctx.fillStyle = s.active ? '#2f66c9' : '#17479e'; ctx.fill(); ctx.restore(); ctx.stroke();
        line(ctx, x, -5, x, h + 5); line(ctx, x - 5, h / 2, x + 5, h / 2); focus(); break;
      }
      case 'bar':
        lines(0, 0, w * s.value, h, 4);
        ctx.save(); ctx.globalAlpha *= 0.25; ctx.fillRect(0, 0, w * s.value, h); ctx.restore();
        bpFrame(ctx, f, 0, 0, w, h, { label: false, t }); break;
      default:
        f.draw();
        if (f.heading) {
          // A dimension line under a heading, with its length.
          const y = h + 4, x2 = w * t;
          ctx.lineWidth = 0.8; line(ctx, 0, y, x2, y); line(ctx, 0.5, y - 4, 0.5, y + 4); line(ctx, x2 - 0.5, y - 4, x2 - 0.5, y + 4);
        }
    }
  },
};
// #endregion blueprint

export const skins = { native, glass: glassSkin, pencil, gel, terminal, blueprint };
