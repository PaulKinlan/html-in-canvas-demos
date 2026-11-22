// canvas-skin-themes-gl.js: skins for <canvas-skin> that run a fragment shader. Polished metal, sea, space.
//
// Every shader here runs in the one WebGL context that the glass skin made (shade() in glass-gl.js), on a
// canvas that is not in the document. A wrapper's own canvas stays 2D: it draws the shader's answer with
// drawImage(). When there is no WebGL, or the context was lost, each skin draws a plain 2D version.

import { shade } from './glass-gl.js';
import { clamp, lerp, smooth, outCubic, rng, rr, circle, shapes, grab } from './canvas-skin-draw.js';

// Run a shader over one box of an element and draw the answer there. False if there is no shader to run.
function panel(ctx, f, name, body, box, values, shot = null) {
  const out = shade(name, body, { x: box.x, y: box.y, width: box.w, height: box.h, radius: box.r, seed: (f.seed % 997) / 997 }, f.scale, values, shot?.image, shot);
  if (!out) return false;
  ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, box.x, box.y, box.w, box.h);
  return true;
}
const boxPath = (ctx, b) => rr(ctx, b.x, b.y, b.w, b.h, b.r);
const lightVector = (degrees) => { const a = (degrees * Math.PI) / 180; return [Math.sin(a), -Math.cos(a)]; };

// -------------------------------------------------------------------------------------------- metal
// #region metal
// A bevelled plate of polished metal. The surface normal comes from the bevel and from a fine grain
// along x (the brushing). The view direction is reflected in it and looked up in a studio: light above,
// dark floor below, a sharp horizon. uShift moves the horizon, so the reflection slides when pressed.
const METAL = `
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
  float grain = (noise(vec2(p.x * 0.035 + uSeed * 50.0, p.y * 2.6)) - 0.5) + 0.5 * (noise(vec2(p.x * 0.09, p.y * 7.0 + uSeed * 9.0)) - 0.5);
  n = normalize(n + vec3(0.0, grain * uBrush, 0.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float v = r.y * 1.4 + (p.y / uSize.y) * 0.9 - 0.3 + uShift + (fbm(vec2(p.x * 0.012 + uSeed * 7.0, 1.0)) - 0.5) * 0.14;
  vec3 col = studio(v) * uTone;
  float facing = dot(g, uLight);
  col += pow(clamp(facing * uPress, 0.0, 1.0), 2.0) * (1.0 - t) * 0.45;
  col *= 1.0 - 0.4 * clamp(-facing * uPress, 0.0, 1.0) * (1.0 - t);
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const METAL_TYPE = 'color: #e9ecf1; color-scheme: dark; font-family: "Helvetica Neue", "DIN Alternate", "Segoe UI", Roboto, system-ui, sans-serif;';
const METAL_TONE = { body: [1, 1, 1.02], primary: [1.0, 0.82, 0.45], well: [0.92, 0.94, 0.98], fill: [0.55, 0.75, 1.0], track: [0.5, 0.52, 0.56], knob: [1, 1, 1.02], dot: [0.25, 0.27, 0.3] };

const metal = {
  label: 'Polished metal',
  type: METAL_TYPE,
  root: `${METAL_TYPE} background-color: #2a2d33; background-image: repeating-linear-gradient(90deg, rgb(255 255 255 / .035) 0 1px, rgb(255 255 255 / 0) 1px 3px), linear-gradient(180deg, #3d4149, #1c1e23);`,
  css: 'caret-color: #14161a; &[kind="button"] > *, &[kind="field"] > * { color: #14161a; } & ::placeholder { color: rgb(20 22 26 / .5); }',
  filters: `
    <filter id="metal-engrave" x="-2%" y="-10%" width="104%" height="130%" color-interpolation-filters="sRGB">
      <feOffset in="SourceAlpha" dy="1" result="o"/>
      <feColorMatrix in="o" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .65 0" result="light"/>
      <feMerge><feMergeNode in="light"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 9 });
    const shift = (1 - outCubic(f.t)) * -1.7 + (s.active ? 0.3 : s.hover ? 0.1 : 0);
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = '#14161a'; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      if (b.role === 'frame') {
        // A card is a line engraved in the plate: a dark line and a light one under it.
        ctx.save(); ctx.lineWidth = 1; boxPath(ctx, b); ctx.strokeStyle = 'rgb(0 0 0 / .55)'; ctx.stroke();
        rr(ctx, b.x, b.y + 1, b.w, b.h, b.r); ctx.strokeStyle = 'rgb(255 255 255 / .16)'; ctx.stroke(); ctx.restore(); continue;
      }
      const sunk = b.role === 'well' || b.role === 'track';
      if (!sunk) { ctx.save(); boxPath(ctx, b); ctx.shadowColor = 'rgb(0 0 0 / .6)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = (s.active ? 1 : 2.5) * f.scale; ctx.fillStyle = '#555'; ctx.fill(); ctx.restore(); }
      const values = { uBevel: Math.min(sunk ? 3 : 6, b.h / 2), uPress: sunk || (s.active && kind === 'button') ? -1 : 1, uBrush: b.role === 'knob' ? 0.03 : sunk ? 0.04 : 0.07, uShift: shift, uTone: METAL_TONE[b.role], uLight: lightVector(315) };
      if (!panel(ctx, f, 'metal', METAL, b, values)) {
        // No shader: a vertical gradient with the same horizon.
        ctx.save(); boxPath(ctx, b); const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h), [tr, tg, tb] = METAL_TONE[b.role], c = (v) => `rgb(${v * tr} ${v * tg} ${v * tb})`;
        g.addColorStop(0, c(250)); g.addColorStop(0.5, c(165)); g.addColorStop(0.52, c(80)); g.addColorStop(1, c(185)); ctx.fillStyle = g; ctx.fill(); ctx.restore();
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
  label: 'Sea',
  type: SEA_TYPE,
  root: `${SEA_TYPE} background-color: #064a80; background-image: repeating-linear-gradient(105deg, rgb(255 255 255 / .05) 0 30px, rgb(255 255 255 / 0) 30px 90px), linear-gradient(180deg, #0f86bd 0%, #064a80 45%, #03264d 100%);`,
  css: 'caret-color: #fff; & ::placeholder { color: rgb(234 252 255 / .55); }',

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s, bleed: b } = f;
    const t = smooth(f.t), { list, rest } = shapes(ctx, f, { radius: 14, pill: true });
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

    const shot = grab(ctx, f, false);
    const box = f.el.getBoundingClientRect();
    const whole = { x: -b, y: -b, w: w + 2 * b, h: h + 2 * b, r: 0 };
    const values = { uOrigin: [box.left + scrollX + w / 2, box.top + scrollY + h / 2], uAmp: lerp(6, kind === 'field' || kind === 'text' ? 1.1 : 1.8, t), uLightAmt: 0.55 };
    if (panel(ctx, f, 'sea', SEA, whole, values, shot)) f.wait = 50;        // 20 pictures a second
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
// Each box is a heavy object in front of the stars. Near its edge the shader reads the background from
// further out, so the stars outside are squeezed into a ring round the rim, and the middle is dark.
const SPACE = `
vec4 shade(vec2 p) {
  float d = -sdBox(p), e = 0.6;
  vec2 g = vec2(sdBox(p + vec2(e, 0.0)) - sdBox(p - vec2(e, 0.0)), sdBox(p + vec2(0.0, e)) - sdBox(p - vec2(0.0, e)));
  g /= max(length(g), 1e-5);
  float t = clamp(d / uRim, 0.0, 1.0);
  vec2 q = p + g * uPull * (1.0 - t) * (1.0 - t) - g * uPull * 0.6 * t * (1.0 - t);
  vec3 sky = back(q).rgb;
  float hole = smoothstep(0.1, 1.0, t);
  vec3 col = sky * (1.0 - hole * 0.9) * (1.0 + 2.2 * (1.0 - t));
  float ring = exp(-pow((d - uRim * 0.22) / (uRim * 0.2), 2.0));
  float swirl = fbm(vec2(atan(p.y / uSize.y, p.x / uSize.x) * 4.0 + uSeed * 20.0, d * 0.25));
  col += uGlow * ring * (0.35 + swirl);
  col = mix(col, uTint.rgb, uTint.a * hole);
  return vec4(col, clamp(d * uScale + 0.5, 0.0, 1.0));
}`;
const SPACE_TYPE = 'color: #f2f4ff; color-scheme: dark; font-family: "Futura", "Century Gothic", "Avenir Next", "Segoe UI", system-ui, sans-serif;';
const SPACE_TILE = 480, SPACE_PAD = 28;
const STARS = (() => { const r = rng(4242); return Array.from({ length: 44 }, () => ({ x: 6 + Math.round(r() * (SPACE_TILE - 12)), y: 6 + Math.round(r() * (SPACE_TILE - 12)), r: r() < 0.15 ? 1.6 : r() < 0.5 ? 1 : 0.6, a: (0.45 + r() * 0.55).toFixed(2) })); })();
const SPACE_GLOW = { body: [1.0, 0.62, 0.25], primary: [0.55, 0.8, 1.0], well: [0.6, 0.45, 1.0], frame: [0.3, 0.3, 0.6], fill: [0.4, 1.0, 0.8], track: [0.3, 0.3, 0.5] };
const SPACE_TINT = { body: [0.02, 0.02, 0.06, 0.2], primary: [0.16, 0.22, 0.75, 0.75], well: [0.05, 0.03, 0.14, 0.5], frame: [0, 0, 0, 0], fill: [0.05, 0.4, 0.35, 0.7], track: [0.02, 0.02, 0.08, 0.6] };
// A planet: a lit sphere, and a ring when it is large enough.
function planet(ctx, x, y, r, hue) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, 0, x, y, r);
  g.addColorStop(0, `hsl(${hue} 90% 88%)`); g.addColorStop(0.55, `hsl(${hue} 70% 55%)`); g.addColorStop(1, `hsl(${hue + 30} 60% 14%)`);
  circle(ctx, x, y, r); ctx.fillStyle = g; ctx.fill();
  if (r > 9) { ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4); ctx.scale(1, 0.3); circle(ctx, 0, 0, r * 1.45); ctx.strokeStyle = `hsl(${hue} 60% 85% / .8)`; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
}

const space = {
  label: 'Space',
  type: SPACE_TYPE,
  root: `${SPACE_TYPE} background-color: #05060f; background-image: ${STARS.map((s) => `radial-gradient(circle at ${s.x}px ${s.y}px, rgb(255 255 255 / ${s.a}) 0, rgb(255 255 255 / ${s.a}) ${s.r}px, rgb(255 255 255 / 0) ${s.r + 0.7}px)`).join(', ')}; background-size: ${SPACE_TILE}px ${SPACE_TILE}px;`,
  css: 'caret-color: #fff; & ::placeholder { color: rgb(242 244 255 / .5); }',

  backdrop(ctx, root, region) {
    ctx.fillStyle = '#05060f'; ctx.fillRect(region.x, region.y, region.width, region.height);
    ctx.fillStyle = '#fff';
    for (let ty = Math.floor(region.y / SPACE_TILE); ty * SPACE_TILE < region.y + region.height; ty++) {
      for (let tx = Math.floor(region.x / SPACE_TILE); tx * SPACE_TILE < region.x + region.width; tx++) {
        for (const s of STARS) { ctx.globalAlpha = Number(s.a); circle(ctx, tx * SPACE_TILE + s.x, ty * SPACE_TILE + s.y, s.r + 0.3); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
  },

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const { list, rest } = shapes(ctx, f, { radius: 14, pill: true });
    const arrive = 1 - outCubic(f.t);
    let copy = null;
    for (const b of list) {
      ctx.save();
      if (b.role === 'mark') { b.path(); ctx.strokeStyle = '#fff'; ctx.shadowColor = '#9fd0ff'; ctx.shadowBlur = 6 * f.scale; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); }
      else if (b.role === 'knob' || b.role === 'dot') planet(ctx, b.x + b.w / 2, b.y + b.h / 2, b.r, kind === 'switch' ? lerp(215, 38, s.on) : kind === 'range' ? lerp(200, 20, s.value) : 45);
      else if (b.role === 'fill' && (kind === 'range' || kind === 'bar')) {
        // A comet's tail up to the value.
        const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0); g.addColorStop(0, 'rgb(120 220 255 / 0)'); g.addColorStop(0.8, 'rgb(120 220 255 / .8)'); g.addColorStop(1, '#fff');
        boxPath(ctx, b); ctx.shadowColor = '#78dcff'; ctx.shadowBlur = 8 * f.scale; ctx.fillStyle = g; ctx.fill();
      } else if (b.role === 'track' && kind !== 'switch') { boxPath(ctx, b); ctx.fillStyle = 'rgb(255 255 255 / .14)'; ctx.fill(); }
      else {
        copy ??= f.backdropCopy(SPACE_PAD);
        const rim = Math.min(b.role === 'frame' ? 10 : 16, b.h / 2);
        const values = { uRim: rim, uPull: (s.active ? 34 : s.hover ? 26 : 22) * (1 + 5 * arrive), uGlow: SPACE_GLOW[b.role].map((v) => v * (s.focus ? 1.8 : 1)), uTint: SPACE_TINT[b.role] };
        if (!copy || !panel(ctx, f, 'space', SPACE, b, values, copy)) { boxPath(ctx, b); ctx.fillStyle = 'rgb(0 0 0 / .75)'; ctx.fill(); ctx.strokeStyle = `rgb(${SPACE_GLOW[b.role].map((v) => Math.round(v * 255)).join(' ')})`; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.restore();
    }
    if (rest === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 14); ctx.clip(); f.draw({ alpha: f.t }); ctx.restore(); ctx.save(); rr(ctx, 0, 0, w, h, 14); ctx.strokeStyle = 'rgb(159 208 255 / .7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
    else if (rest !== 'control') f.draw({ alpha: 0.2 + 0.8 * f.t });
    if (s.focus && (kind === 'check' || kind === 'radio' || kind === 'switch' || kind === 'range')) { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, h); ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  },
};
// #endregion space

export const skins = { metal, sea, space };
