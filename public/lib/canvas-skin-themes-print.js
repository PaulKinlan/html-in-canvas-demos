// canvas-skin-themes-print.js: four more skins for <canvas-skin>. 1-bit (black and white pixels with an
// ordered dither), ASCII (every shape is typed characters), comic (ink outlines and halftone dots) and
// 3D blocks (each element is a block seen in perspective from the middle of the window).
//
// The 1-bit dither and the comic halftone of a picture are fragment shaders that run in the one WebGL
// context shared by all skins (shade() in glass-gl.js). Everything else here is 2D canvas drawing.

import { shade } from './glass-gl.js';
import { TAU, clamp, lerp, smooth, outCubic, rng, rr, circle, knobX, tickPath, shapes, grab } from './canvas-skin-draw.js';

const boxPath = (ctx, b) => rr(ctx, b.x, b.y, b.w, b.h, b.r);
const pagePoint = (f) => { const box = f.el.getBoundingClientRect(); return [box.left + scrollX + f.width / 2, box.top + scrollY + f.height / 2]; };
// Run a shader over the whole wrapper, reading the picture in `shot`, and draw the answer.
function pass(ctx, f, name, body, values, shot) {
  const b = f.bleed, out = shade(name, body, { x: -b, y: -b, width: f.width + 2 * b, height: f.height + 2 * b, radius: 0, seed: (f.seed % 997) / 997 }, f.scale, values, shot.image, shot);
  if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, -b, -b, f.width + 2 * b, f.height + 2 * b);
  else { ctx.save(); ctx.resetTransform(); ctx.drawImage(shot.image, 0, 0, shot.sw, shot.sh, 0, 0, shot.sw, shot.sh); ctx.restore(); }
  return !!out;
}

// --------------------------------------------------------------------------------------------- 1-bit
// #region onebit
// Two colours and nothing between them. The shapes are drawn in greys in 2D, the shader cuts the picture
// into square pixels (uCell CSS px) and turns each one fully to ink or fully to paper by comparing its
// brightness with a threshold from an 8 by 8 Bayer matrix, so a grey becomes a pattern. Text is drawn
// after the shader, so it is not dithered. On arrival the element dissolves in by the same matrix.
const DITHER = `
float b2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float b4(vec2 a) { return b2(0.5 * a) * 0.25 + b2(a); }
float b8(vec2 a) { return b4(0.5 * a) * 0.25 + b2(a); }
vec4 shade(vec2 p) {
  vec2 c = floor((p + uOrigin) / uCell);
  vec4 px = back((c + 0.5) * uCell - uOrigin);
  float l = dot(px.rgb, vec3(0.3, 0.59, 0.11));
  float th = b8(c);
  vec3 col = mix(uInk, uPaper, step(th, l * 1.08 - 0.04));
  return vec4(col, step(0.2, px.a) * step(th, uT * 1.08));
}`;
const BIT_INKS = { black: ['#111111', '#ffffff'], blue: ['#12227a', '#eef1ff'], green: ['#0d3b22', '#d7f5c9'], amber: ['#2b1700', '#ffb52e'], night: ['#e8f0ff', '#0a0e1a'] };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const BIT_TYPE = 'color: var(--bit-ink, #111); font-family: "Chicago", "ChicagoFLF", "Charcoal", "Geneva", "Verdana", system-ui, sans-serif; font-weight: 700; -webkit-font-smoothing: none;';
const GREY = { body: '#ffffff', primary: '#000000', well: '#ffffff', frame: '#ffffff', track: '#9a9a9a', fill: '#3a3a3a', knob: '#ffffff', dot: '#000000' };
const onebit = {
  label: '1-bit',
  type: BIT_TYPE,
  root: `${BIT_TYPE} background-color: var(--bit-paper, #fff); background-image: conic-gradient(var(--bit-ink, #111) 25%, rgb(0 0 0 / 0) 0); background-size: 4px 4px;`,
  css: 'caret-color: var(--bit-ink, #111); & ::placeholder { color: color-mix(in srgb, var(--bit-ink, #111) 55%, transparent); } &[kind="button"] > .primary { color: var(--bit-paper, #fff); }',
  settings: { cell: 2, ink: 'black' },
  options: [
    { key: 'cell', label: 'Size of a pixel', min: 1, max: 5, step: 0.5, unit: ' px' },
    { key: 'ink', label: 'Ink and paper', choices: { black: 'Black', blue: 'Blue', green: 'Green', amber: 'Amber', night: 'White on black' } },
  ],
  vars: (o) => { const [ink, paper] = BIT_INKS[o.ink] ?? BIT_INKS.black; return `--bit-ink: ${ink}; --bit-paper: ${paper};`; },

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f, o = onebit.settings;
    const [ink, paper] = BIT_INKS[o.ink] ?? BIT_INKS.black;
    const { list, rest } = shapes(ctx, f, { radius: kind === 'button' ? 8 : 2 });
    if (kind === 'check') for (const b of list) if (b.role === 'fill') b.role = 'dot';      // a ticked box is solid ink
    const down = s.active && kind === 'button' ? 2 : 0;
    // Text that lies on the root's pattern gets a plate of paper under it.
    if (rest === 'text') { ctx.fillStyle = '#fff'; ctx.fillRect(-4, -1, w + 8, h + 2); }
    for (const b of list) {
      if (b.role === 'mark') continue;
      const lifted = b.role === 'body' || b.role === 'primary' || b.role === 'knob' || b.role === 'frame';
      ctx.save(); ctx.translate(lifted ? down : 0, lifted ? down : 0);
      // A hard shadow, two pixels down and to the right.
      if (lifted && !down) { rr(ctx, b.x + 3, b.y + 3, b.w, b.h, b.r); ctx.fillStyle = '#000'; ctx.fill(); }
      boxPath(ctx, b); ctx.fillStyle = s.disabled && b.role === 'body' ? '#c4c4c4' : s.active && b.role === 'body' ? '#000' : s.hover && b.role === 'body' ? '#d0d0d0' : GREY[b.role]; ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = s.focus && (b.role === 'well' || b.role === 'body' || b.role === 'primary') ? 4 : 2; ctx.stroke();
      if (b.role === 'primary') { rr(ctx, b.x + 4, b.y + 4, b.w - 8, b.h - 8, b.r - 3); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    }
    for (const b of list) if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = kind === 'check' ? '#fff' : '#000'; ctx.lineWidth = kind === 'check' ? 4 : 2.5; ctx.lineCap = ctx.lineJoin = 'miter'; ctx.stroke(); ctx.restore(); }
    if (rest === 'media') { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); f.draw(); ctx.restore(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, h); }
    const shot = grab(ctx, f, false);
    pass(ctx, f, 'dither', DITHER, { uOrigin: pagePoint(f), uCell: o.cell, uInk: hex(ink), uPaper: hex(paper), uT: f.t }, shot);
    if (rest !== 'control' && rest !== 'media') { ctx.save(); ctx.translate(kind === 'button' ? down : 0, kind === 'button' ? down : 0); if (s.active && kind === 'button' && !f.primary) ctx.filter = 'invert(1)'; f.draw({ alpha: clamp(f.t * 2 - 0.6) }); ctx.restore(); }
    if (s.focus && kind !== 'button' && kind !== 'field') { ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(-4, -4, w + 8, h + 8); ctx.restore(); }
  },
};
// #endregion onebit

// --------------------------------------------------------------------------------------------- ASCII
// #region ascii
// Every shape is typed. A button is a box of + - and | characters, a field is brackets and underscores, a
// slider is a row of = and - with an O, a check box is [x]. Each row is one fillText() call in a
// monospace font. A picture is made small (one pixel for each character), read once, and each pixel is
// replaced by a character that has about that much ink. The characters are kept until the picture changes.
const RAMPS = { ascii: ' .:-=+*#%@', blocks: ' ░▒▓█', binary: ' 0011', dots: ' ·•●' };
const ASCII_INKS = { white: '#e6ecff', green: '#58ff7a', amber: '#ffb52e', pink: '#ff7ad9' };
const ASCII_TYPE = 'color: var(--ascii, #e6ecff); color-scheme: dark; font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;';
const FONT = (size, bold) => `${bold ? 700 : 400} ${size}px ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace`;
let charWidth = 0, charFor = 0;
const pictures = new WeakMap();     // element -> { key, rows } : the characters of a picture
let tiny = null;
function pictureRows(ctx, f, cols, lines, ramp) {
  const key = [cols, lines, ramp, f.el.currentSrc || f.el.src || '', f.el.complete].join('|');
  const held = pictures.get(f.el);
  if (held?.key === key) return held.rows;
  const shot = grab(ctx, f);
  // A plain canvas with one pixel for each character. It is read once for each size of the picture.
  tiny ??= document.createElement('canvas');
  if (tiny.width < cols) tiny.width = cols;
  if (tiny.height < lines) tiny.height = lines;
  const t = tiny.getContext('2d', { willReadFrequently: true });
  const k = f.scale, b = f.bleed;
  t.clearRect(0, 0, cols, lines);
  t.drawImage(shot.image, b * k, b * k, f.width * k, f.height * k, 0, 0, cols, lines);
  const data = t.getImageData(0, 0, cols, lines).data;      // gfx-allow: readback a plain cols by lines canvas, read once per picture size and kept
  // The darkest pixel of the picture is the first character and the lightest is the last.
  const light = [];
  for (let i = 0; i < cols * lines * 4; i += 4) light.push(((data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255) * (data[i + 3] / 255));
  const low = Math.min(...light), span = Math.max(...light) - low || 1;
  const rows = [];
  for (let y = 0; y < lines; y++) {
    let row = '';
    for (let x = 0; x < cols; x++) row += ramp[Math.min(ramp.length - 1, Math.floor(((light[y * cols + x] - low) / span) * ramp.length))];
    rows.push(row);
  }
  pictures.set(f.el, { key, rows });
  return rows;
}
const ascii = {
  label: 'ASCII',
  type: ASCII_TYPE,
  root: `${ASCII_TYPE} background-color: #0a0d18; background-image: linear-gradient(rgb(255 255 255 / .03) 50%, rgb(0 0 0 / 0) 50%); background-size: 100% 4px;`,
  css: 'caret-color: var(--ascii, #e6ecff); & ::placeholder { color: color-mix(in srgb, var(--ascii, #e6ecff) 50%, transparent); }',
  settings: { size: 12, ink: 'white', ramp: 'ascii' },
  options: [
    { key: 'size', label: 'Size of a character', min: 8, max: 18, step: 1, unit: ' px' },
    { key: 'ink', label: 'Colour', choices: { white: 'White', green: 'Green', amber: 'Amber', pink: 'Pink' } },
    { key: 'ramp', label: 'Characters of a picture', choices: { ascii: ' .:-=+*#%@', blocks: ' ░▒▓█', binary: '0 and 1', dots: ' ·•●' } },
  ],
  vars: (o) => `--ascii: ${ASCII_INKS[o.ink] ?? ASCII_INKS.white};`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f, o = ascii.settings;
    const ink = ASCII_INKS[o.ink] ?? ASCII_INKS.white, size = o.size, lh = Math.round(size * 1.15);
    ctx.font = FONT(size, kind === 'button' && f.primary);
    if (charFor !== size) { charWidth = ctx.measureText('M').width; charFor = size; }
    const cw = charWidth, cols = Math.max(2, Math.floor(w / cw)), x0 = (w - cols * cw) / 2;
    const lines = Math.max(1, Math.floor(h / lh)), y0 = (h - lines * lh) / 2;
    ctx.fillStyle = ink; ctx.textBaseline = 'middle';
    // On arrival each row is typed from the left, and the rows start one after another.
    const typed = (text, row, rowsInAll = lines) => { const n = Math.ceil(text.length * clamp(f.t * 1.6 - (row / Math.max(1, rowsInAll)) * 0.6)); return n >= text.length ? text : text.slice(0, n) + (n > 0 ? '_' : ''); };
    const put = (text, row, x = x0, rowsInAll = lines) => ctx.fillText(typed(text, row, rowsInAll), x, y0 + (row + 0.5) * lh);
    const mid = (lines - 1) / 2;
    const bright = s.active ? 1 : s.hover ? 0.85 : 0.7;
    switch (kind) {
      case 'button': {
        const edge = f.primary ? '=' : '-', corner = f.primary ? '#' : '+', side = f.primary ? '#' : '|';
        ctx.globalAlpha *= bright;
        if (s.active) { ctx.save(); ctx.globalAlpha *= 0.3; ctx.fillRect(x0, y0, cols * cw, lines * lh); ctx.restore(); }
        put(corner + edge.repeat(cols - 2) + corner, 0); put(corner + edge.repeat(cols - 2) + corner, lines - 1);
        for (let r = 1; r < lines - 1; r++) { put(side, r); put(side, r, x0 + (cols - 1) * cw); }
        if (s.focus) { put('>', mid, x0 + cw); put('<', mid, x0 + (cols - 2) * cw); }
        ctx.globalAlpha /= bright;
        f.draw({ alpha: clamp(f.t * 2 - 0.5) });
        break;
      }
      case 'field': {
        ctx.globalAlpha *= s.focus ? 1 : 0.75;
        for (let r = 0; r < lines; r++) { put('[', r); put(']', r, x0 + (cols - 1) * cw); }
        ctx.fillText(typed('_'.repeat(cols - 2), 0), x0 + cw, h - lh / 2 - 1);
        if (f.el.localName === 'select') put('v', mid, x0 + (cols - 3) * cw);
        ctx.globalAlpha /= s.focus ? 1 : 0.75;
        f.draw({ alpha: clamp(f.t * 2 - 0.5) });
        break;
      }
      case 'card': {
        ctx.globalAlpha *= 0.45;
        put('.' + '-'.repeat(cols - 2) + '.', 0); put("'" + '-'.repeat(cols - 2) + "'", lines - 1);
        for (let r = 1; r < lines - 1; r++) { put(':', r); put(':', r, x0 + (cols - 1) * cw); }
        ctx.globalAlpha /= 0.45;
        f.draw({ alpha: clamp(f.t * 2 - 0.5) });
        break;
      }
      case 'media': {
        const rows = pictureRows(ctx, f, cols, lines, RAMPS[o.ramp] ?? RAMPS.ascii);
        ctx.font = FONT(size, false); ctx.fillStyle = ink; ctx.textBaseline = 'middle';
        rows.forEach((row, r) => put(row, r, x0, rows.length));
        break;
      }
      case 'check': ctx.font = FONT(Math.min(size + 3, 16), true); ctx.textAlign = 'center'; ctx.fillText(s.on > 0.5 ? '[x]' : '[ ]', w / 2, h / 2); break;
      case 'radio': ctx.font = FONT(Math.min(size + 3, 16), true); ctx.textAlign = 'center'; ctx.fillText(s.on > 0.5 ? '(o)' : '( )', w / 2, h / 2); break;
      case 'switch': { ctx.font = FONT(Math.min(size + 2, 15), true); const n = Math.max(4, Math.floor(w / ctx.measureText('M').width) - 2), at = Math.round(s.on * (n - 1)); ctx.textAlign = 'center'; ctx.fillText('[' + '='.repeat(at) + 'O' + '-'.repeat(n - 1 - at) + ']', w / 2, h / 2); break; }
      case 'range': { const at = Math.round(s.value * (cols - 1)); put('='.repeat(at) + (s.active ? '@' : 'O') + '-'.repeat(cols - 1 - at), mid); break; }
      case 'bar': { const n = cols - 2, at = Math.round(s.value * n); ctx.fillText('[' + '#'.repeat(at) + '.'.repeat(n - at) + ']', x0, h / 2); break; }
      default: f.draw({ alpha: clamp(f.t * 1.5) });
    }
    ctx.textAlign = 'left';
    if (s.focus && kind !== 'button' && kind !== 'field') { ctx.font = FONT(size, true); ctx.fillText('>', -cw - 1, h / 2); }
  },
};
// #endregion ascii

// --------------------------------------------------------------------------------------------- comic
// #region comic
// Printed comic. Shapes have a thick ink outline, a hard shadow and flat colour with a screen of dots
// over part of it. A picture is separated into cyan, magenta and yellow, each printed as a grid of dots
// at its own angle whose size follows the amount of that ink, with black lines where the picture changes
// quickly. A pressed button gets a burst behind it.
const HALFTONE = `
float dotOf(vec2 q, float angle, float amount) {
  float c = cos(angle), s = sin(angle);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / uDot;
  return smoothstep(0.08, -0.08, length(fract(r) - 0.5) - 0.72 * sqrt(clamp(amount, 0.0, 1.0)) * 0.7);
}
float lum(vec2 p) { vec4 c = back(p); return dot(c.rgb, vec3(0.3, 0.59, 0.11)); }
vec4 shade(vec2 p) {
  vec2 q = p + uOrigin;
  vec4 px = back(p);
  vec3 rgb = px.rgb;
  rgb = clamp((rgb - 0.5) * 1.25 + 0.55, 0.0, 1.0);
  vec3 cmy = 1.0 - rgb;
  vec3 paper = vec3(0.99, 0.97, 0.9);
  vec3 col = paper;
  col *= mix(vec3(1.0), vec3(0.0, 0.68, 0.94), dotOf(q, 0.26, cmy.r));
  col *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), dotOf(q, 1.31, cmy.g));
  col *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), dotOf(q, 0.0, cmy.b));
  float edge = length(vec2(lum(p + vec2(1.2, 0.0)) - lum(p - vec2(1.2, 0.0)), lum(p + vec2(0.0, 1.2)) - lum(p - vec2(0.0, 1.2))));
  col = mix(col, vec3(0.06, 0.05, 0.1), smoothstep(0.12, 0.3, edge));
  return vec4(col, px.a * step(p.x / uSize.x + 0.5, uT * 1.05));
}`;
const COMICS = {
  classic: { paper: '#fdf7e3', ink: '#14121c', body: '#ffe14d', primary: '#ff3b30', well: '#ffffff', fill: '#2f9bff', dots: '#ff3b30', burst: '#ffb300' },
  pop: { paper: '#fff0f7', ink: '#1b1030', body: '#5df2e0', primary: '#ff3fa4', well: '#ffffff', fill: '#ffe14d', dots: '#7a4fd0', burst: '#ffe14d' },
  news: { paper: '#efe9da', ink: '#1a1a1a', body: '#ffffff', primary: '#1a1a1a', well: '#ffffff', fill: '#6b6b6b', dots: '#1a1a1a', burst: '#bdbdbd' },
};
const COMIC_TYPE = 'color: var(--comic-ink, #14121c); color-scheme: light; font-family: "Comic Sans MS", "Chalkboard SE", "Comic Neue", "Marker Felt", "Trebuchet MS", cursive; font-weight: 700; font-style: italic;';
const dotTiles = new Map();
function dots(ctx, colour, size) {
  const key = `${colour}|${size}`;
  if (!dotTiles.has(key)) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.fillStyle = colour;
    for (const [cx, cy] of [[8, 8], [24, 24]]) { x.beginPath(); x.arc(cx, cy, 5.2, 0, TAU); x.fill(); }
    dotTiles.set(key, c);
  }
  const pattern = ctx.createPattern(dotTiles.get(key), 'repeat');
  pattern.setTransform(new DOMMatrix().scale(size / 16));
  return pattern;
}
function burst(ctx, cx, cy, r1, r2, points, turn = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = turn + (i / (points * 2)) * TAU, r = i % 2 ? r1 : r2; ctx.lineTo(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r); }
  ctx.closePath();
}
const comic = {
  label: 'Comic',
  type: COMIC_TYPE,
  root: `${COMIC_TYPE} background-color: var(--comic-paper, #fdf7e3); background-image: radial-gradient(circle at 5px 5px, color-mix(in srgb, var(--comic-ink, #14121c) 13%, transparent) 0 1.3px, rgb(0 0 0 / 0) 1.7px); background-size: 10px 10px;`,
  css: 'caret-color: var(--comic-ink, #14121c); & ::placeholder { color: color-mix(in srgb, var(--comic-ink, #14121c) 50%, transparent); } &[kind="button"] > .primary { color: #fff; }',
  settings: { dot: 5, colours: 'classic' },
  options: [
    { key: 'dot', label: 'Size of a dot', min: 3, max: 10, step: 0.5, unit: ' px' },
    { key: 'colours', label: 'Colours', choices: { classic: 'Classic', pop: 'Pop', news: 'Newsprint' } },
  ],
  vars: (o) => { const c = COMICS[o.colours] ?? COMICS.classic; return `--comic-ink: ${c.ink}; --comic-paper: ${c.paper};`; },

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f, o = comic.settings, c = COMICS[o.colours] ?? COMICS.classic;
    const { list, rest } = shapes(ctx, f, { radius: 6 });
    // Each element lands with a bounce.
    const pop = f.t < 1 ? 1 + Math.exp(-6 * f.t) * Math.cos(f.t * 13) * -0.3 : 1;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(pop, pop); ctx.rotate((1 - smooth(f.t)) * -0.05); ctx.translate(-w / 2, -h / 2);
    const down = s.active && kind === 'button';
    if (down) { ctx.save(); burst(ctx, w / 2, h / 2, h * 0.62, h * 0.95, 13, f.seed); ctx.fillStyle = c.burst; ctx.fill(); ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
    for (const b of list) {
      if (b.role === 'mark') continue;
      const lifted = b.role === 'body' || b.role === 'primary' || b.role === 'knob' || b.role === 'well' || b.role === 'frame';
      const push = down && (b.role === 'body' || b.role === 'primary') ? 3 : 0;
      ctx.save(); ctx.translate(push, push); ctx.lineJoin = 'round';
      if (lifted && !push) { rr(ctx, b.x + 4, b.y + 4, b.w, b.h, b.r); ctx.fillStyle = c.ink; ctx.fill(); }
      const flat = { body: c.body, primary: c.primary, well: c.well, frame: c.paper, track: c.well, fill: c.fill, knob: c.body, dot: c.primary }[b.role];
      boxPath(ctx, b); ctx.fillStyle = flat; ctx.fill();
      // The screen of dots: over the lower right of a button, over all of a filled track.
      if (b.role === 'body' || b.role === 'fill' || b.role === 'frame') {
        ctx.save(); boxPath(ctx, b); ctx.clip();
        if (b.role !== 'fill') { ctx.beginPath(); ctx.moveTo(b.x + b.w * (b.role === 'frame' ? 0.72 : 0.45), b.y + b.h); ctx.lineTo(b.x + b.w, b.y + (b.role === 'frame' ? b.h - 46 : 0)); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.closePath(); ctx.clip(); }
        ctx.globalAlpha *= b.role === 'frame' ? 0.35 : 0.8; ctx.fillStyle = dots(ctx, b.role === 'fill' ? c.ink : c.dots, o.dot); ctx.fillRect(b.x, b.y, b.w, b.h); ctx.restore();
      }
      boxPath(ctx, b); ctx.strokeStyle = s.focus && lifted && b.role !== 'frame' ? c.fill : c.ink; ctx.lineWidth = b.role === 'frame' ? 2.5 : 3; ctx.stroke();
      // A white line of shine on a button and a knob.
      if (b.role === 'primary' || b.role === 'knob') { ctx.beginPath(); ctx.moveTo(b.x + Math.min(b.r, 8) + 2, b.y + 5); ctx.lineTo(b.x + Math.min(b.w * 0.4, 40), b.y + 5); ctx.strokeStyle = 'rgb(255 255 255 / .85)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke(); }
      ctx.restore();
    }
    for (const b of list) if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = kind === 'check' ? '#fff' : c.ink; ctx.lineWidth = kind === 'check' ? 4.5 : 3; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); if (kind === 'check') { ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2; } ctx.restore(); }
    // A field is a speech balloon: it has a tail.
    if (kind === 'field' && f.el.localName !== 'select') { ctx.save(); ctx.beginPath(); ctx.moveTo(18, h - 1.5); ctx.lineTo(12, h + 11); ctx.lineTo(32, h - 1.5); ctx.fillStyle = c.well; ctx.fill(); ctx.strokeStyle = s.focus ? c.fill : c.ink; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(18, h); ctx.lineTo(12, h + 11); ctx.lineTo(32, h); ctx.stroke(); ctx.restore(); }
    if (rest === 'media') {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); f.draw(); ctx.restore();
      const shot = grab(ctx, f, false);
      ctx.fillStyle = c.ink; ctx.fillRect(5, 5, w, h);
      pass(ctx, f, 'halftone', HALFTONE, { uOrigin: pagePoint(f), uDot: o.dot, uT: f.t }, shot);
      ctx.strokeStyle = c.ink; ctx.lineWidth = 3.5; ctx.strokeRect(0, 0, w, h);
    } else if (rest !== 'control') { ctx.save(); if (down) ctx.translate(3, 3); f.draw(); ctx.restore(); }
    ctx.restore();
    if (s.focus && kind !== 'button' && kind !== 'field') { ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = c.fill; ctx.lineWidth = 3; rr(ctx, -5, -5, w + 10, h + 10, 8); ctx.stroke(); ctx.restore(); }
  },
};
// #endregion comic

// ------------------------------------------------------------------------------------------ 3D blocks
// #region blocks
// Every element is a block that stands out of the wall, or a hole cut into it, seen from a point in
// front of the middle of the window. The face of a block stays where the element is in the layout, so
// taps land where they look. Its back is drawn nearer to the middle of the window, and the sides that
// join the two are the sides you would see from there: an element on the left of the window shows its
// right side. Scrolling moves every element relative to the middle, so each is painted again and the
// sides turn. Tilting the device, or moving the mouse, moves the viewpoint.
const BLOCK_TYPE = 'color: #26303f; color-scheme: light; font-family: "Avenir Next", "Segoe UI", Roboto, "Helvetica Neue", system-ui, sans-serif;';
const BLOCKS = { body: ['#ffffff', '#c3cedd', '#98a7bd'], primary: ['#ff6a4d', '#d2452c', '#a8301c'], frame: ['#f4f7fb', '#c3cedd', '#a3b1c6'], knob: ['#ffd23f', '#d9a514', '#b28208'], fill: ['#22b8a7', '#178f82', '#0f6f65'], dot: ['#ff6a4d', '#d2452c', '#a8301c'] };
const HOLE = { floor: '#c9d3e0', wallLight: '#9eadc2', wallDark: '#6f7f99' };
const view = [0, 0];                    // the viewpoint, as a shift from the middle of the window: -1..1
let viewListening = false, viewFrame = 0;
function turnBlocks() { viewFrame = 0; for (const el of document.querySelectorAll('canvas-skin[now="blocks"]')) el.requestSoon?.(); }
function listenForView() {
  if (viewListening || typeof window === 'undefined') return;
  viewListening = true;
  const again = () => { viewFrame ||= requestAnimationFrame(turnBlocks); };
  addEventListener('scroll', again, { passive: true });
  addEventListener('resize', again, { passive: true });
  let last = 0;
  const set = (x, y) => { const now = performance.now(); if (now - last < 50 || Math.hypot(x - view[0], y - view[1]) < 0.02) return; last = now; view[0] = x; view[1] = y; again(); };
  addEventListener('deviceorientation', (e) => { if (e.gamma != null && blocks.settings.tilt) set(clamp(e.gamma / 35, -1, 1), clamp((e.beta - 45) / 35, -1, 1)); });
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && blocks.settings.tilt) set((e.clientX / innerWidth - 0.5) * 1.6, (e.clientY / innerHeight - 0.5) * 1.6); }, { passive: true });
}
// The side faces of a box whose back is shifted by ox, oy: at most two are seen.
function sides(ctx, b, ox, oy, light, dark) {
  const { x, y, w, h } = b, r = Math.min(b.r, 3);
  if (Math.abs(oy) > 0.2) { const yy = oy > 0 ? y + h : y; ctx.beginPath(); ctx.moveTo(x + r, yy); ctx.lineTo(x + w - r, yy); ctx.lineTo(x + w - r + ox, yy + oy); ctx.lineTo(x + r + ox, yy + oy); ctx.closePath(); ctx.fillStyle = oy > 0 ? dark : light; ctx.fill(); }
  if (Math.abs(ox) > 0.2) { const xx = ox > 0 ? x + w : x; ctx.beginPath(); ctx.moveTo(xx, y + r); ctx.lineTo(xx, y + h - r); ctx.lineTo(xx + ox, y + h - r + oy); ctx.lineTo(xx + ox, y + r + oy); ctx.closePath(); ctx.fillStyle = ox > 0 ? light : dark; ctx.fill(); }
}
const blocks = {
  label: '3D blocks',
  type: BLOCK_TYPE,
  root: `${BLOCK_TYPE} background-color: #dfe6ef; background-image: linear-gradient(rgb(255 255 255 / .5) 1px, rgb(255 255 255 / 0) 1px), linear-gradient(90deg, rgb(255 255 255 / .5) 1px, rgb(255 255 255 / 0) 1px), linear-gradient(160deg, #e9eef5, #cfd9e6); background-size: 32px 32px, 32px 32px, auto;`,
  css: 'caret-color: #ff6a4d; & ::placeholder { color: rgb(38 48 63 / .5); } &[kind="button"] > .primary { color: #fff; }',
  settings: { depth: 1, tilt: 1 },
  options: [
    { key: 'depth', label: 'Depth', min: 0, max: 1.3, step: 0.05 },
    { key: 'tilt', label: 'Viewpoint follows tilt', choices: { 1: 'On', 0: 'Off' } },
  ],

  paint(ctx, f) {
    listenForView();
    const { width: w, height: h, kind, state: s } = f, o = blocks.settings;
    // Where the element is, from the viewpoint: -1..1 across the window, and beyond it off screen.
    const box = f.el.getBoundingClientRect();
    const tilt = Number(o.tilt) ? 1 : 0;
    const vx = innerWidth * (0.5 + view[0] * 0.5 * tilt), vy = innerHeight * (0.45 + view[1] * 0.4 * tilt);
    const dx = clamp((vx - (box.left + w / 2)) / (innerWidth * 0.5), -1.4, 1.4), dy = clamp((vy - (box.top + h / 2)) / (innerHeight * 0.5), -1.4, 1.4);
    const rise = f.t < 1 ? outCubic(f.t) * (1 + 0.5 * Math.sin(f.t * Math.PI)) : 1;         // the blocks rise out of the wall
    const unit = 9 * o.depth * rise;
    // The shift of something `depth` units behind the face (a negative depth is in front of it).
    const back = (depth) => [clamp(dx * unit * depth, -13, 13), clamp(dy * unit * depth, -13, 13)];
    const { list, rest } = shapes(ctx, f, { radius: 5 });
    const hole = (b, depth, floor = HOLE.floor) => {
      const [ox, oy] = back(depth);
      ctx.save(); boxPath(ctx, b); ctx.clip();
      ctx.fillStyle = HOLE.wallDark; ctx.fillRect(b.x, b.y, b.w, b.h);
      // The two inner walls that face the viewpoint.
      ctx.fillStyle = HOLE.wallLight;
      if (oy < 0) ctx.fillRect(b.x, b.y + b.h + oy, b.w, -oy + 1); else ctx.fillRect(b.x, b.y, b.w, oy);
      rr(ctx, b.x + ox, b.y + oy, b.w, b.h, b.r); ctx.fillStyle = floor; ctx.fill();
      ctx.restore();
      ctx.save(); boxPath(ctx, b); ctx.strokeStyle = s.focus ? '#ff6a4d' : 'rgb(255 255 255 / .9)'; ctx.lineWidth = s.focus ? 2.5 : 1; ctx.stroke(); ctx.restore();
      return [ox, oy];
    };
    const block = (b, depth, [top, light, dark]) => {
      const [ox, oy] = back(depth);
      // Its shadow on the wall, from a light at the upper left.
      ctx.save(); rr(ctx, b.x + ox + depth * 2.5, b.y + oy + depth * 3.5, b.w, b.h, b.r); ctx.fillStyle = 'rgb(40 60 90 / .28)'; ctx.shadowColor = 'rgb(40 60 90 / .35)'; ctx.shadowBlur = 5 * depth * f.scale; ctx.fill(); ctx.restore();
      if (b.r >= b.h / 2 - 0.5) { ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = dark; ctx.lineWidth = b.h; ctx.beginPath(); ctx.moveTo(b.x + b.h / 2, b.y + b.h / 2); ctx.lineTo(b.x + b.w - b.h / 2 + 0.01, b.y + b.h / 2); ctx.translate(ox, oy); ctx.lineTo(b.x + b.w - b.h / 2, b.y + b.h / 2); ctx.lineTo(b.x + b.h / 2, b.y + b.h / 2); ctx.stroke(); ctx.restore(); }   // a round thing is a cylinder
      else { rr(ctx, b.x + ox, b.y + oy, b.w, b.h, b.r); ctx.fillStyle = dark; ctx.fill(); sides(ctx, b, ox, oy, light, dark); }
      boxPath(ctx, b); ctx.fillStyle = top; ctx.fill();
      ctx.strokeStyle = 'rgb(255 255 255 / .7)'; ctx.lineWidth = 1; ctx.stroke();
    };
    let shift = [0, 0];
    for (const b of list) {
      if (b.role === 'mark') { ctx.save(); b.path(); ctx.strokeStyle = kind === 'check' ? '#fff' : '#26303f'; ctx.lineWidth = kind === 'check' ? 3.4 : 2.2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); continue; }
      if (b.role === 'well') shift = hole(b, kind === 'field' ? 0.75 : 0.4, '#f7f9fc');
      else if (b.role === 'track') hole(b, 0.3);
      else if (b.role === 'frame') block(b, 0.35, BLOCKS.frame);
      else if (b.role === 'fill' && kind === 'check') block(b, 0.4 * s.on, BLOCKS.fill);
      else if (b.role === 'dot') block(b, 0.35, BLOCKS.dot);
      else if (b.role === 'fill') block(b, kind === 'bar' ? 0.5 : 0.25, BLOCKS.fill);
      else block(b, b.role === 'knob' ? (s.active ? 0.9 : 0.6) : s.active && kind === 'button' ? 0.2 : s.hover ? 1.25 : 1, BLOCKS[b.role] ?? BLOCKS.body);
    }
    if (rest === 'media') {
      // A picture is at the bottom of a deep hole, as in a shadow box.
      const b = { x: 0, y: 0, w, h, r: 4 }, [ox, oy] = back(1.3);
      ctx.save(); boxPath(ctx, b); ctx.clip();
      ctx.fillStyle = HOLE.wallDark; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = HOLE.wallLight; if (oy < 0) ctx.fillRect(0, h + oy, w, -oy + 1); else ctx.fillRect(0, 0, w, oy);
      ctx.translate(w / 2 + ox, h / 2 + oy); ctx.scale(0.95, 0.95); ctx.translate(-w / 2, -h / 2); f.draw();
      ctx.restore();
      ctx.save(); boxPath(ctx, b); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    } else if (rest === 'picture') f.draw(kind === 'field' ? { x: shift[0], y: shift[1] } : {});
    else if (rest === 'text') {
      // Letters with thickness: the picture is drawn a few times toward the back, darker, then once in place.
      const [ox, oy] = back(f.heading ? 0.5 : 0.25), n = Math.ceil(Math.hypot(ox, oy) * Math.min(f.scale, 2));
      for (let i = n; i >= 1; i--) f.draw({ x: (ox * i) / n, y: (oy * i) / n, alpha: 0.16 });
      f.draw();
    }
    if (s.focus && kind !== 'field') { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 9); ctx.strokeStyle = '#ff6a4d'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  },
};
// #endregion blocks

export const skins = { onebit, ascii, comic, blocks };
