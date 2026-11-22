// canvas-skin-themes-gl.js: skins for <canvas-skin> that run a fragment shader. Polished metal, sea, space,
// holographic foil, and four that repaint the element's picture: screen print, crayon, impressionist, old master.
//
// Every shader here runs in the one WebGL context that the glass skin made (shade() in glass-gl.js), on a
// canvas that is not in the document. A wrapper's own canvas stays 2D: it draws the shader's answer with
// drawImage(). When there is no WebGL, or the context was lost, each skin draws a plain 2D version.

import { shade, holds } from './glass-gl.js';
import { clamp, lerp, smooth, outCubic, rng, rr, circle, shapes, grab } from './canvas-skin-draw.js';

// Run a shader over one box of an element and draw the answer there. False if there is no shader to run.
function panel(ctx, f, name, body, box, values, shot = null, keep = null) {
  const out = shade(name, body, { x: box.x, y: box.y, width: box.w, height: box.h, radius: box.r, seed: (f.seed % 997) / 997, keep: keep?.el, sig: keep?.sig }, f.scale, values, shot?.image, shot);
  if (!out) return false;
  ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, box.x, box.y, box.w, box.h);
  return true;
}
const boxPath = (ctx, b) => rr(ctx, b.x, b.y, b.w, b.h, b.r);
const lightVector = (degrees) => { const a = (degrees * Math.PI) / 180; return [Math.sin(a), -Math.cos(a)]; };

// -------------------------------------------------------------------------------------------- metal
// #region metal
// Brushed metal. The brushing is noise stretched a long way in one direction: along x on a plate, round
// the centre on a knob. Light on a brushed surface spreads across the grooves, so the highlight is a
// soft band across a plate and two bright spokes on a knob. uBand and uSpoke say where they are, and
// they follow the tilt of the device. The bevel at the edge is lit from uLight.
const BRUSHED = `
vec4 shade(vec2 p) {
  float d = -sdBox(p), e = 0.6;
  vec2 g = vec2(sdBox(p + vec2(e, 0.0)) - sdBox(p - vec2(e, 0.0)), sdBox(p + vec2(0.0, e)) - sdBox(p - vec2(0.0, e)));
  g /= max(length(g), 1e-5);
  float streak, light;
  if (uRound > 0.5) {
    float r = length(p), a = atan(p.y, p.x);
    streak = noise(vec2(r * 2.4 + uSeed * 40.0, a * 0.5)) * 0.6 + noise(vec2(r * 6.0, a * 1.5 + 3.0)) * 0.4;
    light = pow(abs(cos(a - uSpoke)), 7.0) * (0.55 + 0.45 * smoothstep(0.0, uSize.x * 0.5, r));
  } else {
    vec2 q = p + uSeed * 300.0;
    streak = noise(vec2(q.x * 0.006, q.y * 1.9)) * 0.45 + noise(vec2(q.x * 0.02, q.y * 4.3)) * 0.3 + noise(vec2(q.x * 0.07, q.y * 9.0)) * 0.25;
    float y = p.y / uSize.y + 0.5;
    light = exp(-pow((y - uBand) / 0.3, 2.0)) * (0.8 + 0.2 * sin(p.x / uSize.x * 3.0 + uBand * 4.0));
  }
  float grain = (streak - 0.5) * uGrain;
  vec3 col = uTone * (0.56 + 0.5 * grain) + uSpec * light * (0.36 + 0.9 * grain);
  float t = clamp(d / uBevel, 0.0, 1.0), facing = dot(g, uLight) * uPress;
  col += (1.0 - t) * pow(max(facing, 0.0), 1.5) * 0.4;
  col *= 1.0 - 0.5 * (1.0 - t) * max(-facing, 0.0);
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
// Polished metal: the view direction reflected in a bevelled plate and looked up in a studio with light
// above, a floor below and a sharp horizon.
const CHROME = `
vec3 studio(float v) {
  vec3 above = mix(vec3(0.99, 0.99, 1.0), vec3(0.6, 0.66, 0.75), clamp(-v, 0.0, 1.0));
  vec3 below = mix(vec3(0.42, 0.44, 0.48), vec3(0.8, 0.79, 0.78), clamp(v * 1.6, 0.0, 1.0));
  return mix(above, below, smoothstep(-0.03, 0.03, v));
}
vec4 shade(vec2 p) {
  float d = -sdBox(p), e = 0.6;
  vec2 g = vec2(sdBox(p + vec2(e, 0.0)) - sdBox(p - vec2(e, 0.0)), sdBox(p + vec2(0.0, e)) - sdBox(p - vec2(0.0, e)));
  g /= max(length(g), 1e-5);
  float t = clamp(d / uBevel, 0.0, 1.0);
  float slope = t < 1.0 ? (1.0 - t) / max(sqrt(1.0 - (1.0 - t) * (1.0 - t)), 0.2) : 0.0;
  vec3 n = normalize(vec3(g * slope * uPress, 1.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float v = r.y * 1.4 + (p.y / uSize.y) * 0.9 - 0.8 + uBand + (fbm(vec2(p.x * 0.012 + uSeed * 7.0, 1.0)) - 0.5) * 0.14;
  return vec4(studio(v) * uTone, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const METAL_TYPE = 'color: #e9ecf1; color-scheme: dark; font-family: "Helvetica Neue", "DIN Alternate", "Segoe UI", Roboto, system-ui, sans-serif;';
// tone: the metal's colour. spec: the colour of its highlight. accent: the metal of a primary button.
export const METALS = {
  aluminium: { label: 'Aluminium', tone: [0.8, 0.82, 0.85], spec: [1, 1, 1], grain: 1, accent: 'brass' },
  steel: { label: 'Steel', tone: [0.62, 0.66, 0.72], spec: [0.95, 0.98, 1], grain: 0.8, accent: 'copper' },
  brass: { label: 'Brass', tone: [0.8, 0.63, 0.28], spec: [1, 0.93, 0.62], grain: 0.9, accent: 'aluminium' },
  copper: { label: 'Copper', tone: [0.8, 0.48, 0.34], spec: [1, 0.82, 0.7], grain: 0.9, accent: 'aluminium' },
  chrome: { label: 'Chrome', tone: [1, 1, 1.02], spec: [1, 1, 1], grain: 0, accent: 'brass', polished: true },
};
const BLUE_ANODISED = { tone: [0.3, 0.5, 0.86], spec: [0.8, 0.92, 1], grain: 0.8 };

const metal = {
  label: 'Brushed metal',
  type: METAL_TYPE,
  root: `${METAL_TYPE} background-color: #2a2d33; background-image: repeating-linear-gradient(90deg, rgb(255 255 255 / .035) 0 1px, rgb(255 255 255 / 0) 1px 3px), linear-gradient(180deg, #3d4149, #1c1e23);`,
  css: 'caret-color: #14161a; &[kind="button"] > *, &[kind="field"] > * { color: #14161a; } & ::placeholder { color: rgb(20 22 26 / .5); }',
  filters: `
    <filter id="metal-engrave" x="-2%" y="-10%" width="104%" height="130%" color-interpolation-filters="sRGB">
      <feOffset in="SourceAlpha" dy="1" result="o"/>
      <feColorMatrix in="o" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .65 0" result="light"/>
      <feMerge><feMergeNode in="light"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`,
  settings: { metal: 'aluminium' },

  paint(ctx, f) {
    listenForTilt();
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 9 });
    const main = METALS[metal.settings.metal] ?? METALS.aluminium;
    // The highlight crosses the element as the skin arrives, and moves with tilt and with a press.
    const band = 0.38 + tilt[1] * 0.45 + (1 - outCubic(f.t)) * -1.2 + (s.active ? 0.25 : s.hover ? 0.08 : 0);
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = '#14161a'; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      if (b.role === 'frame') {
        // A card is a line engraved in the plate: a dark line and a light one under it.
        ctx.save(); ctx.lineWidth = 1; boxPath(ctx, b); ctx.strokeStyle = 'rgb(0 0 0 / .55)'; ctx.stroke();
        rr(ctx, b.x, b.y + 1, b.w, b.h, b.r); ctx.strokeStyle = 'rgb(255 255 255 / .16)'; ctx.stroke(); ctx.restore(); continue;
      }
      const sunk = b.role === 'well' || b.role === 'track', round = b.role === 'knob' || b.role === 'dot';
      if (!sunk) { ctx.save(); boxPath(ctx, b); ctx.shadowColor = 'rgb(0 0 0 / .6)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = (s.active ? 1 : 2.5) * f.scale; ctx.fillStyle = '#555'; ctx.fill(); ctx.restore(); }
      const m = b.role === 'primary' ? METALS[main.accent] : b.role === 'fill' ? BLUE_ANODISED : main;
      const dim = b.role === 'track' ? 0.6 : b.role === 'dot' ? 0.35 : sunk ? 0.92 : 1;
      const press = sunk || (s.active && kind === 'button') ? -1 : 1;
      const values = main.polished && !round
        ? { uBevel: Math.min(sunk ? 3 : 6, b.h / 2), uPress: press, uBand: band, uTone: m.tone.map((v) => v * dim) }
        : { uBevel: Math.min(sunk ? 2.5 : 4, b.h / 2), uPress: press, uBand: band, uSpoke: 0.9 + tilt[0] * 1.6 + (kind === 'range' ? s.value * 3 : s.on * 1.5), uRound: round ? 1 : 0, uGrain: m.grain || 0.5, uTone: m.tone.map((v) => v * dim), uSpec: m.spec, uLight: lightVector(315) };
      if (!panel(ctx, f, main.polished && !round ? 'chrome' : 'brushed', main.polished && !round ? CHROME : BRUSHED, b, values)) {
        // No shader: a gradient with the highlight in the same place.
        ctx.save(); boxPath(ctx, b); const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h), c = (v) => `rgb(${m.tone.map((x) => Math.round(x * v * dim)).join(' ')})`;
        g.addColorStop(0, c(150)); g.addColorStop(clamp(band, 0.05, 0.95), c(240)); g.addColorStop(1, c(130)); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      }
    }
    if (rest === 'media') { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 6); ctx.fillStyle = '#14161a'; ctx.fill(); ctx.restore(); f.draw(); }
    else if (rest === 'picture') f.draw(kind === 'card' ? {} : { filter: 'url(#metal-engrave)' });
    else if (rest === 'text') f.draw();
    if (s.focus) { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 12); ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  },
};
// #endregion metal

// ---------------------------------------------------------------------------------------------- sea
// #region sea
// The element is under water. Its picture is read through a moving surface (two layers of noise and a
// slow swell bend the point that is read), and a net of light, the caustics, crosses it.
// uOrigin is the element's place on the page, so the water is continuous from one element to the next.
const SEA = `
vec4 shade(vec2 p) {
  vec2 q = p + uOrigin;
  float tt = uTime * 0.6;
  vec2 bend = vec2(noise(q * 0.035 + vec2(tt, 0.0)) - 0.5, noise(q * 0.035 + vec2(7.3, tt * 0.8)) - 0.5) * 2.0;
  bend += vec2(sin(q.y * 0.09 + tt * 2.2), cos(q.x * 0.07 + tt * 1.7)) * 0.5;
  vec4 c = back(p + bend * uAmp);
  vec2 u = q * 0.022;
  float net = 0.0;
  for (int i = 0; i < 3; i++) {
    u += vec2(sin(u.y * 1.7 + tt + float(i)), cos(u.x * 1.9 - tt * 0.7 + float(i) * 2.1)) * 0.55;
    net += 1.0 / (0.25 + abs(sin(u.x * 2.3) * cos(u.y * 2.1)) * 6.0);
  }
  net = pow(clamp(net / 3.0 * 0.35, 0.0, 1.0), 2.0);
  return vec4(c.rgb + vec3(0.55, 0.95, 1.0) * net * uLightAmt, c.a);
}`;
const SEA_TYPE = 'color: #eafcff; color-scheme: dark; font-family: "Avenir Next", "Nunito", "Segoe UI", system-ui, sans-serif;';
const SEA_FILL = { body: 'rgb(255 255 255 / .16)', primary: 'rgb(255 122 92 / .9)', well: 'rgb(2 30 70 / .4)', frame: 'rgb(255 255 255 / .07)', track: 'rgb(2 30 70 / .5)', fill: 'rgb(63 240 208 / .9)' };

const sea = {
  label: 'Underwater',
  type: SEA_TYPE,
  root: `${SEA_TYPE} background-color: #064a80; background-image: repeating-linear-gradient(105deg, rgb(255 255 255 / .05) 0 30px, rgb(255 255 255 / 0) 30px 90px), linear-gradient(180deg, #0f86bd 0%, #064a80 45%, #03264d 100%);`,
  css: 'caret-color: #fff; & ::placeholder { color: rgb(234 252 255 / .55); }',

  // The element in 2D, before the water: sea glass, pearls, and the element's own picture.
  shapes(ctx, f, t) {
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 14, pill: true });
    ctx.save();
    ctx.translate(0, (1 - t) * 10);                      // the element rises into place
    ctx.globalAlpha *= 0.3 + 0.7 * t;
    for (const box of list) {
      ctx.save();
      if (box.role === 'mark') { box.path(); ctx.strokeStyle = '#fff'; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); }
      else if (box.role === 'knob' || box.role === 'dot') {
        // A pearl.
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2, g = ctx.createRadialGradient(cx - box.r * 0.35, cy - box.r * 0.4, 0, cx, cy, box.r);
        g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#f3e6f0'); g.addColorStop(1, '#b9a9c9');
        boxPath(ctx, box); ctx.fillStyle = g; ctx.fill();
      } else {
        boxPath(ctx, box); ctx.fillStyle = s.active && kind === 'button' ? 'rgb(255 255 255 / .34)' : SEA_FILL[box.role]; ctx.fill();
        ctx.strokeStyle = `rgb(255 255 255 / ${s.focus ? 0.95 : 0.5})`; ctx.lineWidth = s.focus ? 2.5 : 1.2; ctx.stroke();
      }
      ctx.restore();
    }
    if (rest === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 14); ctx.clip(); f.draw(); ctx.restore(); } else if (rest !== 'control') f.draw();
    ctx.restore();

  },

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s, bleed: b } = f;
    const t = smooth(f.t);
    const box = f.el.getBoundingClientRect();
    const whole = { x: -b, y: -b, w: w + 2 * b, h: h + 2 * b, r: 0 };
    const values = { uOrigin: [box.left + scrollX + w / 2, box.top + scrollY + h / 2], uAmp: lerp(6, kind === 'field' || kind === 'text' ? 1.1 : 1.8, t), uLightAmt: 0.55 };
    // The picture is drawn and sent to the shader only when something about the element changed. While
    // only the water moves, the shader reads the texture it already has.
    const sig = f.t < 1 || s.focus ? null : [w, h, f.scale, s.on, s.value, s.hover, s.active, s.disabled, s.open, f.el.value ?? '', (f.el.textContent ?? '').slice(0, 80)].join('|');
    const onScreen = box.bottom > 0 && box.top < innerHeight;
    const rate = onScreen ? 66 : 500;                    // 15 pictures a second on screen, 2 off it
    if (sig && holds(f.el, sig) && panel(ctx, f, 'sea', SEA, whole, values, null, { el: f.el, sig })) { f.wait = rate; return; }
    this.shapes(ctx, f, t);
    const shot = grab(ctx, f, false);
    if (panel(ctx, f, 'sea', SEA, whole, values, shot, { el: f.el, sig: sig ?? `moving ${f.time}` })) f.wait = rate;
    else { ctx.save(); ctx.resetTransform(); ctx.drawImage(shot.image, 0, 0, shot.sw, shot.sh, 0, 0, shot.sw, shot.sh); ctx.restore(); }
    if (f.t < 1) {
      // Bubbles leave the element as it arrives.
      const rand = rng(f.seed); ctx.save(); ctx.strokeStyle = 'rgb(255 255 255 / .7)'; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { const x = rand() * w, r = 1.5 + rand() * 3; circle(ctx, x + Math.sin(f.t * 9 + i) * 3, h * (1 - f.t * (1 + rand())) , r); ctx.globalAlpha = 1 - f.t; ctx.stroke(); }
      ctx.restore();
    }
  },
};
// #endregion sea

// -------------------------------------------------------------------------------------------- space
// #region space
// Gravity. Every wrapped element has a mass in proportion to its size, and so has the finger or the
// pointer. The shader reads each pixel of an element's picture from a place nearer to each mass, by an
// amount that falls with distance, as light passing a heavy object is seen displaced away from it. Where
// the bending is strong the red and blue are read from different places.
const GRAVITY = `
vec2 pull(vec2 q, vec3 m) { vec2 d = q - m.xy; float r = length(d); return d / max(r, 1.0) * m.z / (r + 18.0); }
vec4 shade(vec2 p) {
  vec2 q = p + uOrigin;
  vec2 off = pull(q, uM0) + pull(q, uM1) + pull(q, uM2) + pull(q, uM3) + pull(q, uFinger);
  float len = length(off);
  off *= min(1.0, 13.0 / max(len, 1e-3));
  float k = clamp(len / 13.0, 0.0, 1.0);
  vec4 c = back(p - off);
  vec4 red = back(p - off * (1.0 + 0.3 * k)), blue = back(p - off * (1.0 - 0.3 * k));
  c = vec4(red.r, c.g, blue.b, max(c.a, max(red.a, blue.a) * k));
  c.rgb += vec3(0.4, 0.6, 1.0) * k * k * 0.35;
  return c;
}`;
const SPACE_TYPE = 'color: #f2f4ff; color-scheme: dark; font-family: "Futura", "Century Gothic", "Avenir Next", "Segoe UI", system-ui, sans-serif;';
const SPACE_LOOK = { radius: 14, pill: true, mark: '#fff', focus: '#9fd0ff', line: 1.1, body: ['rgb(255 255 255 / .09)', 'rgb(160 200 255 / .05)', 'rgb(255 255 255 / .6)'], primary: ['#ffffff', '#cfe2ff'], well: ['rgb(0 0 0 / .3)', 'rgb(0 0 0 / .3)', 'rgb(255 255 255 / .38)'], frame: [null, null, 'rgb(255 255 255 / .22)'], track: ['rgb(255 255 255 / .14)', 'rgb(255 255 255 / .14)'], fill: ['rgb(120 220 255 / .25)', '#ffffff'], knob: ['#ffffff', '#9fc4ff'], dot: ['#ffffff', '#ffffff'] };
// The masses on the page: one per wrapper in this skin, measured at most once every 0.8 s.
let masses = [], massesAt = -1e9;
function measureMasses() {
  const now = performance.now();
  if (now - massesAt < 800) return masses;
  massesAt = now;
  masses = [...document.querySelectorAll('canvas-skin[now="space"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.left + scrollX + r.width / 2, y: r.top + scrollY + r.height / 2, mass: Math.sqrt(r.width * r.height) * 2.2, reach: Math.max(r.width, r.height) / 2 };
  }).filter((m) => m.mass > 0);
  return masses;
}
// The finger: a mass that follows the pointer, and fades when it lifts.
const finger = { x: 0, y: 0, mass: 0, target: 0 };
let fingerListening = false, fingerFrame = 0;
function fingerStep() {
  fingerFrame = 0;
  finger.mass += (finger.target - finger.mass) * 0.22;
  if (finger.target === 0 && finger.mass < 4) finger.mass = 0;
  for (const m of masses) if (Math.hypot(m.x - finger.x, m.y - finger.y) < 300 + m.reach) m.el.request?.();
  if (Math.abs(finger.target - finger.mass) > 2) fingerFrame = requestAnimationFrame(fingerStep);
}
function listenForFinger() {
  if (fingerListening || typeof document === 'undefined') return;
  fingerListening = true;
  const at = (e, mass) => { finger.x = e.clientX + scrollX; finger.y = e.clientY + scrollY; finger.target = mass; if (!fingerFrame) fingerFrame = requestAnimationFrame(fingerStep); };
  document.addEventListener('pointerdown', (e) => at(e, 900), { passive: true });
  document.addEventListener('pointermove', (e) => at(e, e.pointerType === 'mouse' && !e.buttons ? 420 : 900), { passive: true });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) document.addEventListener(type, (e) => { if (e.pointerType !== 'mouse' || type !== 'pointerup') at(e, 0); }, { passive: true });
}

const space = {
  label: 'Gravity',
  type: SPACE_TYPE,
  root: `${SPACE_TYPE} background-color: #04050d; background-image: radial-gradient(70% 45% at 85% 8%, rgb(120 40 160 / .5), rgb(120 40 160 / 0)), radial-gradient(60% 40% at 10% 45%, rgb(20 90 140 / .45), rgb(20 90 140 / 0)), radial-gradient(80% 40% at 70% 95%, rgb(170 60 90 / .35), rgb(170 60 90 / 0)), linear-gradient(160deg, #070a1c, #020308);`,
  css: 'caret-color: #fff; & ::placeholder { color: rgb(242 244 255 / .5); } &[kind="button"] > .primary { color: #05060f; }',

  paint(ctx, f) {
    listenForFinger();
    const origin = pagePoint(f);
    // The four masses that bend this element most: heavy and near, and not the element itself.
    const near = measureMasses().filter((m) => m.el !== f.el.parentElement)
      .map((m) => ({ m, pull: m.mass / (Math.hypot(m.x - origin[0], m.y - origin[1]) + 18) }))
      .sort((a, b) => b.pull - a.pull).slice(0, 4);
    const swing = 1 + 4 * (1 - outCubic(f.t)) * Math.cos(f.t * 9);      // the element settles into the field
    const values = { uFinger: [finger.x, finger.y, finger.mass] };
    for (let i = 0; i < 4; i++) values[`uM${i}`] = near[i] ? [near[i].m.x, near[i].m.y, near[i].m.mass * swing] : [0, 0, 0];
    painted(ctx, f, SPACE_LOOK, 'gravity', GRAVITY, values);
  },
};
// #endregion space

// Repaint every wrapper that is in one of these skins, at most once a frame.
let asked = 0;
function repaint(...names) {
  if (asked || typeof document === 'undefined') return;
  asked = requestAnimationFrame(() => { asked = 0; for (const el of document.querySelectorAll(names.map((n) => `canvas-skin[now="${n}"]`).join(','))) el.request?.(); });
}
const pagePoint = (f) => { const box = f.el.getBoundingClientRect(); return [box.left + scrollX + f.width / 2, box.top + scrollY + f.height / 2]; };
const fillBox = (ctx, b, fill, stroke = null, width = 1.5) => { ctx.save(); boxPath(ctx, b); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } ctx.restore(); };
const across = (ctx, b, from, to) => { const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h); g.addColorStop(0, from); g.addColorStop(1, to); return g; };

// --------------------------------------------------------------------------------------------- foil
// #region foil
// Holographic foil. The colour at a point is a place on the spectrum that depends on where the point is
// and on how the device is tilted (uTilt), as a thin film's colour depends on the viewing angle. Fine
// lines stand for the grating, single cells flash as glitter, and a band of glare crosses on arrival.
const FOIL = `
vec3 spectrum(float t) { return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }
vec4 shade(vec2 p) {
  float d = -sdBox(p);
  vec2 q = p + uOrigin;
  float n = fbm(q * 0.012);
  vec3 film = spectrum(dot(q, vec2(0.7, 0.7)) * 0.006 + n * 0.9 + dot(uTilt, vec2(1.3, 1.7)));
  float lines = 0.5 + 0.5 * sin(dot(q, vec2(0.5, 0.86)) * 1.6 + n * 10.0);
  vec3 col = mix(vec3(0.9, 0.91, 0.95), film, uFilm * (0.7 + 0.3 * lines));
  float glare = exp(-pow((dot(p / uSize, vec2(0.8, 0.6)) - uTilt.x * 1.5 - uSweep) * 3.0, 2.0));
  col += glare * 0.5;
  col += step(0.985, fract(hash(floor(q / 1.6)) + uTilt.x * 2.0 + uTilt.y * 3.0)) * 0.8 * uFilm;
  col *= uTone;
  float t = clamp(d / 3.0, 0.0, 1.0);
  col = mix(col * 1.2 + 0.1, col, t);
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const tilt = [0, 0];
let tiltListening = false;
function listenForTilt() {
  if (tiltListening || typeof window === 'undefined') return;
  tiltListening = true;
  // The sensor reports about 60 times a second. The wrappers are painted again at most 12 times a second,
  // and only when the tilt changed by more than a fiftieth of its range.
  let last = 0;
  const set = (x, y) => {
    const now = performance.now();
    if (now - last < 80 || Math.hypot(x - tilt[0], y - tilt[1]) < 0.02) return;
    last = now; tilt[0] = x; tilt[1] = y; repaint('foil', 'metal');
  };
  addEventListener('deviceorientation', (e) => { if (e.gamma != null) set(clamp(e.gamma / 45, -1, 1), clamp((e.beta - 45) / 45, -1, 1)); });
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); }, { passive: true });
}
const FOIL_TYPE = 'color: #17131f; color-scheme: light; font-family: "Avenir Next", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;';
const FOIL_LOOK = { body: [0.75, [1, 1, 1]], primary: [1, [0.62, 0.55, 0.85]], well: [0.22, [1, 1, 1]], frame: [0.3, [1, 1, 1]], track: [0.3, [0.8, 0.8, 0.86]], fill: [1, [0.75, 0.9, 1]], knob: [0.9, [1, 1, 1]], dot: [1, [0.5, 0.45, 0.7]] };

const foil = {
  label: 'Holographic foil',
  type: FOIL_TYPE,
  root: `${FOIL_TYPE} background-color: #f3f2f8; background-image: linear-gradient(125deg, rgb(255 190 230 / .35), rgb(190 230 255 / .35) 50%, rgb(215 255 215 / .35));`,
  css: 'caret-color: #17131f; & ::placeholder { color: rgb(23 19 31 / .5); } &[kind="button"] > .primary { color: #fff; }',

  paint(ctx, f) {
    listenForTilt();
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 12 });
    let origin = null;
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = '#17131f'; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      ctx.save(); boxPath(ctx, b); ctx.shadowColor = 'rgb(60 40 110 / .3)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = (s.active ? 0.5 : 2) * f.scale; ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
      origin ??= pagePoint(f);
      const [film, tone] = FOIL_LOOK[b.role];
      const values = { uOrigin: [origin[0] + b.x + b.w / 2 - w / 2, origin[1] + b.y + b.h / 2 - h / 2], uTilt: [tilt[0] + (s.active ? 0.3 : s.hover ? 0.1 : 0), tilt[1]], uFilm: film, uTone: tone, uSweep: lerp(-1.6, 2.4, f.t) };
      if (!panel(ctx, f, 'foil', FOIL, b, values)) fillBox(ctx, b, across(ctx, b, '#ffd6f2', '#c9f0ff'), 'rgb(23 19 31 / .3)');
    }
    if (rest === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 12); ctx.clip(); f.draw(); ctx.restore(); }
    else if (rest !== 'control') f.draw();
    if (s.focus) { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 15); ctx.strokeStyle = '#7a4dff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  },
};
// #endregion foil

// ------------------------------------------------------------------------------- painting skins
// #region painted
// The four skins below work the same way. The shapes are filled with flat colour and the element's own
// picture is drawn over them, in 2D. grab() takes that as a plain canvas, and one shader pass over the
// whole wrapper turns it into the picture that is shown.
function painted(ctx, f, look, name, body, values, { through = true, wait = 0 } = {}) {
  const { width: w, height: h, kind, state: s, bleed: b } = f;
  const { list, rest } = shapes(ctx, f, { radius: look.radius ?? 10, pill: look.pill });
  for (const box of list) {
    if (box.role === 'mark') { ctx.save(); box.path(); ctx.strokeStyle = look.mark; ctx.lineWidth = kind === 'check' ? 3.2 : 2.2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
    const [from, to, edge] = look[box.role] ?? look.body;
    if (s.active && kind === 'button') ctx.globalAlpha = 0.8;
    fillBox(ctx, box, from ? across(ctx, box, from, to ?? from) : null, s.focus && (box.role === 'well' || box.role === 'body' || box.role === 'primary') ? look.focus : edge, look.line ?? 1.5);
    ctx.globalAlpha = 1;
  }
  if (rest === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, look.radius ?? 10); ctx.clip(); f.draw(); ctx.restore(); }
  else if (rest !== 'control' && (through || rest === 'media')) f.draw();
  const shot = grab(ctx, f, false);
  const whole = { x: -b, y: -b, w: w + 2 * b, h: h + 2 * b, r: 0 };
  if (panel(ctx, f, name, body, whole, { uOrigin: pagePoint(f), ...values }, shot)) f.wait = wait;
  else { ctx.save(); ctx.resetTransform(); ctx.drawImage(shot.image, 0, 0, shot.sw, shot.sh, 0, 0, shot.sw, shot.sh); ctx.restore(); }
  if (rest !== 'control' && rest !== 'media' && !through) f.draw();     // text that the shader must not touch
  if (s.focus && kind !== 'button' && kind !== 'field') { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 12); ctx.strokeStyle = look.focus; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
}
// #endregion painted

// #region poster
// A screen print: each colour is cut to a few levels, dark areas get a screen of dots, and a line is
// drawn wherever the picture changes quickly.
const POSTER = `
float ink(vec2 p) { vec4 c = back(p); return dot(c.rgb, vec3(0.3, 0.59, 0.11)) * c.a + c.a; }
vec4 shade(vec2 p) {
  vec4 c = back(p);
  vec3 q = floor(c.rgb * uLevels + 0.5) / uLevels;
  float edge = smoothstep(0.14, 0.34, length(vec2(ink(p + vec2(1.0, 0.0)) - ink(p - vec2(1.0, 0.0)), ink(p + vec2(0.0, 1.0)) - ink(p - vec2(0.0, 1.0)))));
  vec2 h = mat2(0.707, -0.707, 0.707, 0.707) * (p + uOrigin) / 3.2;
  float l = dot(q, vec3(0.3, 0.59, 0.11));
  q *= 1.0 - 0.3 * step(length(fract(h) - 0.5), 0.42 * (1.0 - l));
  float show = step((p.y / uSize.y + 0.5), uT * 1.05);          // printed from the top down
  return vec4(mix(q, vec3(0.07, 0.05, 0.14), edge), max(c.a, edge) * show);
}`;
const POSTER_TYPE = 'color: #14102a; color-scheme: light; font-family: "Helvetica Neue", "Arial Narrow", Arial, system-ui, sans-serif;';
const POSTER_LOOK = { radius: 4, mark: '#14102a', focus: '#14102a', line: 3, body: ['#00b7ff', '#00b7ff'], primary: ['#ff2e88', '#ff2e88'], well: ['#ffffff', '#ffffff'], frame: [null, null, '#14102a'], track: ['#14102a', '#14102a'], fill: ['#ff2e88', '#00b7ff'], knob: ['#ffffff', '#ffffff'], dot: ['#ff2e88', '#ff2e88'] };
const poster = {
  label: 'Screen print',
  type: POSTER_TYPE,
  root: `${POSTER_TYPE} background-color: #ffd400; background-image: radial-gradient(circle at 4px 4px, rgb(255 120 0 / .35) 0 1.6px, rgb(255 120 0 / 0) 2px); background-size: 8px 8px;`,
  css: 'caret-color: #ff2e88; & ::placeholder { color: rgb(20 16 42 / .5); }',
  paint(ctx, f) { painted(ctx, f, POSTER_LOOK, 'poster', POSTER, { uLevels: f.kind === 'media' ? 3 : 4, uT: f.t }); },
};
// #endregion poster

// #region crayon
// Wax crayon on paper. The picture is read through a slow wobble, and the wax covers the paper only
// where a streak of noise along the stroke direction and the paper's grain allow it. The direction is
// different for each element. On arrival the element is coloured in along that direction.
const CRAYON = `
vec4 shade(vec2 p) {
  vec2 q = p + uOrigin;
  vec2 wob = vec2(noise(q * 0.07) - 0.5, noise(q * 0.07 + 31.0) - 0.5) * 2.0;
  vec4 c = back(p + wob);
  float ang = 0.5 + uSeed * 1.4;
  vec2 dir = vec2(cos(ang), sin(ang));
  float along = dot(q, dir), side = dot(q, vec2(-dir.y, dir.x));
  float stroke = noise(vec2(along * 0.03, side * 0.9));
  float grain = noise(q * 1.7) * 0.6 + noise(q * 0.5) * 0.4;
  float wax = smoothstep(0.2, 0.6, stroke * 0.6 + grain * 0.6);
  float done = smoothstep(0.0, 0.12, uT * 1.25 - ((dot(p / uSize, dir) + 0.7) / 1.4 * 0.8 + stroke * 0.2));
  return vec4(c.rgb * (0.9 + 0.2 * stroke), c.a * mix(0.5, 1.0, wax) * done);
}`;
const CRAYON_TYPE = 'color: #26324d; color-scheme: light; font-family: "Comic Sans MS", "Chalkboard SE", "Comic Neue", "Marker Felt", cursive;';
const CRAYON_LOOK = { radius: 12, mark: '#26324d', focus: '#e0218a', line: 2.6, body: ['#ffd23f', '#ffb347', '#26324d'], primary: ['#ff4b3e', '#ff7a59', '#26324d'], well: ['#ffffff', '#eaf4ff', '#2a6fdb'], frame: [null, null, '#3cb44b'], track: ['#cfe8ff', '#cfe8ff', '#2a6fdb'], fill: ['#3cb44b', '#8fd14f', '#26324d'], knob: ['#ff8c1a', '#ffb347', '#26324d'], dot: ['#ff4b3e', '#ff4b3e'] };
const crayon = {
  label: 'Crayon',
  type: CRAYON_TYPE,
  root: `${CRAYON_TYPE} background-color: #fffdf5; background-image: repeating-linear-gradient(0deg, rgb(90 150 230 / 0) 0 27px, rgb(90 150 230 / .28) 27px 28px);`,
  css: 'caret-color: #e0218a; & ::placeholder { color: rgb(38 50 77 / .5); }',
  paint(ctx, f) { painted(ctx, f, CRAYON_LOOK, 'crayon', CRAYON, { uT: f.t }); },
};
// #endregion crayon

// #region impressionist
// Dabs of paint. The plane is cut into cells with one dab in each, long in one direction and turned by
// a random angle. A pixel takes the colour that the picture has at the centre of the nearest dab.
const DABS = `
vec4 shade(vec2 p) {
  vec2 q = (p + uOrigin) / uDab, cell = floor(q), at = q;
  float best = 1e9, tone = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 o = c + vec2(hash(c), hash(c + 7.7));
    float ang = hash(c + 3.1) * 0.9 - 0.45 + uAngle;
    vec2 d = q - o, r = vec2(d.x * cos(ang) + d.y * sin(ang), (-d.x * sin(ang) + d.y * cos(ang)) * 2.2);
    float dist = dot(r, r) - hash(c + 1.3) * 0.15;
    if (dist < best) { best = dist; at = o; tone = hash(c + 9.9); }
  }
  vec4 c = back(at * uDab - uOrigin);
  vec3 col = c.rgb * (0.86 + 0.28 * tone) + (tone - 0.5) * vec3(0.1, -0.02, 0.12);
  col *= 1.0 - 0.18 * smoothstep(0.1, 0.45, best);              // the edge of a dab is a little darker
  return vec4(col, c.a * step(tone * 0.6, uT * 1.2));           // the dabs are laid one by one
}`;
const DABS_TYPE = 'color: #2d2a4a; color-scheme: light; font-family: Didot, "Bodoni MT", "Iowan Old Style", Georgia, serif;';
const DABS_LOOK = { radius: 14, mark: '#2d2a4a', focus: '#7a3fb0', body: ['#b9a7e6', '#8fc3ea'], primary: ['#f29bb8', '#f6b36b'], well: ['#fbf6e6', '#e9f1df'], frame: ['rgb(255 255 255 / .28)', 'rgb(190 215 240 / .3)'], track: ['#9db89a', '#7fa3a0'], fill: ['#5e9c6b', '#b8cf6a'], knob: ['#ffffff', '#f6c6d8'], dot: ['#e8799f', '#e8799f'] };
const impressionist = {
  label: 'Impressionist',
  type: DABS_TYPE,
  root: `${DABS_TYPE} background-color: #c9d6ee; background-image: radial-gradient(60% 40% at 15% 12%, rgb(246 196 220 / .8), rgb(246 196 220 / 0)), radial-gradient(55% 45% at 85% 35%, rgb(178 222 196 / .8), rgb(178 222 196 / 0)), radial-gradient(70% 40% at 40% 80%, rgb(250 232 170 / .7), rgb(250 232 170 / 0)), radial-gradient(50% 35% at 90% 95%, rgb(170 180 235 / .8), rgb(170 180 235 / 0));`,
  css: 'caret-color: #7a3fb0; & ::placeholder { color: rgb(45 42 74 / .5); }',
  paint(ctx, f) { painted(ctx, f, DABS_LOOK, 'dabs', DABS, { uDab: f.kind === 'media' ? 7 : f.kind === 'button' || f.kind === 'field' || f.kind === 'card' ? 5 : 3, uAngle: 0.6, uT: f.t }, { through: false }); },
};
// #endregion impressionist

// #region oldmaster
// An oil painting lit by one lamp. uLamp is a point on the page: the last place the page was touched.
// Colour is pulled toward warm brown, brightness falls with distance from the lamp, and the paint has
// canvas weave and a net of fine cracks (the borders between the cells of a Voronoi diagram).
const OIL = `
vec4 shade(vec2 p) {
  vec2 q = p + uOrigin;
  vec4 c = back(p);
  float far = length(q - uLamp) / uReach;
  float light = 1.15 * exp(-far * far) + 0.36;
  float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  vec3 col = mix(vec3(l), c.rgb, 0.75) * vec3(1.05, 0.9, 0.68) * light * uT;
  col *= 0.94 + 0.06 * sin(q.x * 2.2) * sin(q.y * 2.2);
  vec2 g = q / 9.0, cell = floor(g);
  float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 k = cell + vec2(float(i), float(j));
    float dd = length(g - k - vec2(hash(k), hash(k + 5.0)));
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
  }
  col *= 0.72 + 0.28 * smoothstep(0.0, 0.05, f2 - f1);
  return vec4(col, c.a);
}`;
let lamp = null, lampListening = false;
function listenForLamp() {
  if (lampListening || typeof document === 'undefined') return;
  lampListening = true;
  const move = (e) => { if (e.type === 'pointermove' && e.pointerType === 'mouse' && !e.buttons && Math.hypot(e.clientX + scrollX - lamp[0], e.clientY + scrollY - lamp[1]) < 12) return; lamp = [e.clientX + scrollX, e.clientY + scrollY]; repaint('oldmaster'); };
  document.addEventListener('pointerdown', move, { passive: true });
  document.addEventListener('pointermove', move, { passive: true });
}
const OIL_TYPE = 'color: #f1dfb6; color-scheme: dark; font-family: Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif;';
const OIL_LOOK = { radius: 5, mark: '#f6e7b8', focus: '#ffd86b', body: ['#c9973f', '#8a5a1e', '#3a2408'], primary: ['#b32a22', '#6e120f', '#e3b54a'], well: ['#3a2714', '#24170b', '#a67c2e'], frame: ['rgb(60 40 20 / .35)', 'rgb(30 20 10 / .35)', '#a67c2e'], track: ['#2a1c10', '#2a1c10', '#6b4e1e'], fill: ['#e3b54a', '#a67c2e'], knob: ['#fff3c9', '#c9973f', '#3a2408'], dot: ['#fff3c9', '#e3b54a'] };
const oldmaster = {
  label: 'Old master',
  type: OIL_TYPE,
  root: `${OIL_TYPE} background-color: #17100a; background-image: radial-gradient(120% 80% at 30% 20%, rgb(92 60 24 / .55), rgb(10 6 3 / .6));`,
  css: 'caret-color: #ffd86b; & ::placeholder { color: rgb(241 223 182 / .5); } &[kind="button"] > :not(.primary) { color: #24170b; }',
  paint(ctx, f) {
    lamp ??= [scrollX + innerWidth * 0.4, scrollY + innerHeight * 0.35];
    listenForLamp();
    painted(ctx, f, OIL_LOOK, 'oil', OIL, { uLamp: lamp, uReach: 430, uT: 0.15 + 0.85 * smooth(f.t) });
  },
};
// #endregion oldmaster

// ----------------------------------------------------------------------------------- stained glass
// #region stained
// A leaded window. The box is cut into the cells of a Voronoi diagram. Each cell is a piece of glass in
// a colour between uA and uB, uneven in brightness, and the borders between cells and round the box are
// lead. On arrival the pieces light one at a time.
const STAINED = `
vec4 shade(vec2 p) {
  float d = -sdBox(p);
  vec2 g = (p + uSeed * 400.0) / uPiece, cell = floor(g), id = cell;
  float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 k = cell + vec2(float(i), float(j));
    float dd = length(g - k - vec2(hash(k), hash(k + 5.0)));
    if (dd < f1) { f2 = f1; f1 = dd; id = k; } else if (dd < f2) f2 = dd;
  }
  float tone = hash(id + 2.0);
  vec3 col = mix(uA, uB, tone) * (0.72 + 0.5 * hash(id + 8.0));
  col *= 0.8 + 0.4 * fbm(p * 0.09 + id);                                  // the glass is uneven
  col += 0.25 * pow(fbm(p * 0.03 + uSeed * 9.0), 3.0);                     // light behind it
  col *= mix(0.12, 1.0, step(hash(id + 4.0) * 0.8, uT));                   // not lit yet
  float lead = min(smoothstep(0.02, 0.09, f2 - f1), smoothstep(1.6, 3.0, d));
  col = mix(vec3(0.07, 0.07, 0.09), col * uGlow, lead);
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const STAINED_TYPE = 'color: #f3e3b0; color-scheme: dark; font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;';
const PANES = { body: ['#1d5fd0', '#35b6e8'], primary: ['#d6262b', '#f2a31b'], well: ['#efe6c4', '#cfe6da'], fill: ['#1f9d55', '#b6d93b'], track: ['#2a1d4a', '#56347a'], knob: ['#f2a31b', '#ffe066'], dot: ['#d6262b', '#ff7a59'] };
const stained = {
  label: 'Stained glass',
  type: STAINED_TYPE,
  root: `${STAINED_TYPE} background-color: #15131a; background-image: linear-gradient(rgb(255 255 255 / .04) 1px, rgb(255 255 255 / 0) 1px), radial-gradient(100% 70% at 50% 0%, rgb(120 100 160 / .25), rgb(0 0 0 / .3)); background-size: 100% 46px, auto;`,
  css: 'caret-color: #15101c; &[kind="button"] > *, &[kind="field"] > * { color: #15101c; font-weight: 700; } & ::placeholder { color: rgb(21 16 28 / .55); }',
  // Lettering on glass: a pale ground round each letter keeps it readable over the lead lines.
  filters: `
    <filter id="stained-ink" x="-5%" y="-20%" width="110%" height="140%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="fat"/>
      <feGaussianBlur in="fat" stdDeviation="1.6" result="soft"/>
      <feColorMatrix in="soft" type="matrix" values="0 0 0 0 1  0 0 0 0 .97  0 0 0 0 .86  0 0 0 .9 0" result="ground"/>
      <feMerge><feMergeNode in="ground"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`,
  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 8 });
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = '#111016'; ctx.lineWidth = kind === 'check' ? 3.4 : 2.2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      if (b.role === 'frame') { fillBox(ctx, b, null, '#3a3642', 3); fillBox(ctx, b, null, 'rgb(255 255 255 / .12)', 1); continue; }
      const [from, to] = PANES[b.role];
      const values = { uPiece: Math.max(7, Math.min(22, b.h * 0.42)), uA: hex(from), uB: hex(to), uT: f.t, uGlow: s.active ? 1.5 : s.hover || s.focus ? 1.25 : 1 };
      if (!panel(ctx, f, 'stained', STAINED, b, values)) fillBox(ctx, b, across(ctx, b, from, to), '#111016', 2.5);
    }
    if (rest === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 8); ctx.clip(); f.draw({ alpha: f.t }); ctx.restore(); ctx.save(); rr(ctx, 0, 0, w, h, 8); ctx.strokeStyle = '#111016'; ctx.lineWidth = 4; ctx.stroke(); ctx.restore(); }
    else if (rest !== 'control') f.draw(kind === 'button' || kind === 'field' ? { filter: 'url(#stained-ink)' } : {});
    if (s.focus) { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 11); ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    if (f.t < 1) f.again = true;
  },
};
// #endregion stained

// --------------------------------------------------------------------------------------------- clay
// #region clay
// Modelling clay. The outline is a little uneven (noise added to the distance to the edge), the surface
// is rounded over at the rim and dented by more noise, and it is lit from the upper left with a soft
// highlight. uJit changes the noise: while an element arrives or is pressed it changes 8 times a second,
// as a model moved by hand between photographs does.
const CLAY = `
vec4 shade(vec2 p) {
  float d = -sdBox(p) + (noise(p * 0.08 + uJit * 17.0) - 0.5) * 3.0 - 1.5, e = 0.6;
  vec2 g = vec2(sdBox(p + vec2(e, 0.0)) - sdBox(p - vec2(e, 0.0)), sdBox(p + vec2(0.0, e)) - sdBox(p - vec2(0.0, e)));
  g /= max(length(g), 1e-5);
  float t = clamp(d / uPuff, 0.0, 1.0);
  float slope = t < 1.0 ? (1.0 - t) / max(sqrt(1.0 - (1.0 - t) * (1.0 - t)), 0.3) : 0.0;
  vec2 dent = vec2(noise(p * 0.3 + uJit * 5.0), noise(p * 0.3 + 9.0 + uJit * 5.0)) - 0.5;
  vec3 n = normalize(vec3(g * slope * uPress + dent * 0.45, 1.0));
  vec2 thumb = (vec2(hash(vec2(uSeed, 1.0)), hash(vec2(uSeed, 2.0))) - 0.5) * uSize;
  float print = 0.5 + 0.5 * sin(length(p - thumb) * 1.7 + noise(p * 0.1) * 4.0);
  vec3 L = normalize(vec3(-0.5, -0.6, 0.75));
  vec3 col = uTone * (0.5 + 0.6 * clamp(dot(n, L), 0.0, 1.0)) * (0.95 + 0.05 * print);
  col += pow(clamp(reflect(-L, n).z, 0.0, 1.0), 16.0) * 0.16;
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const CLAY_TYPE = 'color: #4a2f1b; color-scheme: light; font-family: "Arial Rounded MT Bold", "Varela Round", Nunito, "Trebuchet MS", system-ui, sans-serif;';
const CLAY_TONE = { body: '#2bb3a3', primary: '#f0553a', well: '#fff3d6', track: '#d9b382', fill: '#7bc74d', knob: '#ffcf33', dot: '#7a4fd0' };
const clay = {
  label: 'Clay',
  type: CLAY_TYPE,
  root: `${CLAY_TYPE} background-color: #f3d9b1; background-image: radial-gradient(120% 80% at 30% 10%, rgb(255 255 255 / .35), rgb(160 110 50 / .18));`,
  css: 'caret-color: #f0553a; & ::placeholder { color: rgb(74 47 27 / .5); } &[kind="button"] > * { color: #fff; }',
  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 14 });
    const moving = f.t < 1 || s.active;
    const jit = moving ? Math.floor(f.time * 8) % 64 : 0;
    // The element is squashed and springs out as it arrives.
    const k = f.t < 1 ? 1 + Math.exp(-5 * f.t) * Math.cos(f.t * 14) * -0.35 : 1;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(1 + (k - 1) * 0.5, k); ctx.translate(-w / 2, -h / 2);
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = kind === 'check' ? '#fff' : '#4a2f1b'; ctx.lineWidth = kind === 'check' ? 4 : 3; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      if (b.role === 'frame') { fillBox(ctx, b, null, '#c98d4f', 5); fillBox(ctx, { ...b, y: b.y - 1 }, null, 'rgb(255 255 255 / .35)', 1.2); continue; }
      const sunk = b.role === 'well' || b.role === 'track';
      if (!sunk) { ctx.save(); boxPath(ctx, b); ctx.shadowColor = 'rgb(90 50 10 / .45)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = (s.active ? 1 : 3) * f.scale; ctx.fillStyle = CLAY_TONE[b.role]; ctx.fill(); ctx.restore(); }
      const big = { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4, r: b.r + 2 };       // room for the uneven outline
      const values = { uPuff: Math.min(sunk ? 5 : 9, b.h / 2), uPress: sunk || (s.active && kind === 'button') ? -1 : 1, uJit: jit, uTone: hex(CLAY_TONE[b.role]) };
      if (!panel(ctx, f, 'clay', CLAY, big, values)) fillBox(ctx, b, CLAY_TONE[b.role], 'rgb(74 47 27 / .4)', 2);
    }
    if (rest === 'media') { ctx.save(); rr(ctx, -5, -5, w + 10, h + 10, 16); ctx.fillStyle = '#fff3d6'; ctx.shadowColor = 'rgb(90 50 10 / .45)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = 3 * f.scale; ctx.fill(); ctx.restore(); ctx.save(); rr(ctx, 0, 0, w, h, 12); ctx.clip(); f.draw(); ctx.restore(); }
    else if (rest !== 'control') f.draw();
    ctx.restore();
    if (s.focus) { ctx.save(); rr(ctx, -5, -5, w + 10, h + 10, 18); ctx.strokeStyle = '#7a4fd0'; ctx.lineWidth = 3; ctx.setLineDash([2, 6]); ctx.lineCap = 'round'; ctx.stroke(); ctx.restore(); }
    if (moving) f.wait = 125;
    if (f.t < 1) f.again = true;
  },
};
// #endregion clay

export const skins = { metal, sea, space, foil, poster, crayon, impressionist, oldmaster, stained, clay };
