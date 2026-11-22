// canvas-skin-draw.js: drawing helpers shared by the skins in canvas-skin-themes-more.js and
// canvas-skin-themes-gl.js. A skin is described at the top of canvas-skin-themes.js.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const outCubic = (t) => 1 - (1 - t) ** 3;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2))); };
export const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); };
export const line = (ctx, x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
// Centre of the knob of a range or a switch: the knob is k wide and stays inside the track.
export const knobX = (f, v, k = f.height) => k / 2 + v * (f.width - k);
// The path of a check mark in the square x, y, s, up to the fraction t.
export function tickPath(ctx, x, y, s, t = 1) {
  const a = [x + s * 0.24, y + s * 0.54], b = [x + s * 0.43, y + s * 0.72], c = [x + s * 0.78, y + s * 0.3];
  const t1 = clamp(t * 2.5), t2 = clamp((t - 0.4) / 0.6);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]);
  ctx.lineTo(lerp(a[0], b[0], t1), lerp(a[1], b[1], t1));
  if (t2 > 0) ctx.lineTo(lerp(b[0], c[0], t2), lerp(b[1], c[1], t2));
}
// The path of the arrow of a <select>, which has no drawing of its own once appearance is none.
export function chevronPath(ctx, f) {
  const x = f.width - 22, y = f.height / 2;
  ctx.beginPath(); ctx.moveTo(x - 6, y - 3); ctx.lineTo(x, y + 3); ctx.lineTo(x + 6, y - 3);
}
export const isSelect = (f) => f.el.localName === 'select';

// #region parts
// The shapes of each kind of element, the same in every skin that uses this. A skin gives part(path, role):
// path() makes the current path, and role says what the shape is:
//   body, primary (a button)   well (a field, an empty check box or radio)   frame (a card)
//   track, fill (a switch, a range, a bar)   knob   mark (a line: the tick, the select arrow)   dot
// After the shapes of a button, field or card the skin draws the element's own picture.
export function parts(ctx, f, part, { radius = 8, pill = false } = {}) {
  const { width: w, height: h, kind, state: s } = f;
  switch (kind) {
    case 'button': part(() => rr(ctx, 0, 0, w, h, pill ? h / 2 : radius), f.primary ? 'primary' : 'body'); return 'picture';
    case 'field': part(() => rr(ctx, 0, 0, w, h, radius), 'well'); if (isSelect(f)) part(() => chevronPath(ctx, f), 'mark'); return 'picture';
    case 'card': part(() => rr(ctx, 0, 0, w, h, radius + 4), 'frame'); return 'picture';
    case 'check':
      part(() => rr(ctx, 2, 2, w - 4, h - 4, Math.min(radius, 6)), s.on > 0.5 ? 'fill' : 'well');
      if (s.on > 0.05) part(() => tickPath(ctx, 2, 2, w - 4, s.on), 'mark');
      return 'control';
    case 'radio':
      part(() => circle(ctx, w / 2, h / 2, h / 2 - 2), 'well');
      if (s.on > 0.05) part(() => circle(ctx, w / 2, h / 2, (h / 2 - 7) * s.on), 'dot');
      return 'control';
    case 'switch':
      part(() => rr(ctx, 0, 2, w, h - 4, h / 2), s.on > 0.5 ? 'fill' : 'track');
      part(() => circle(ctx, knobX(f, s.on), h / 2, h / 2 - 4), 'knob');
      return 'control';
    case 'range': {
      const x = knobX(f, s.value);
      part(() => rr(ctx, 0, h / 2 - 4, w, 8, 4), 'track');
      if (x > 4) part(() => rr(ctx, 0, h / 2 - 4, x, 8, 4), 'fill');
      part(() => circle(ctx, x, h / 2, h / 2 - 1), 'knob');
      return 'control';
    }
    case 'bar':
      part(() => rr(ctx, 0, 0, w, h, h / 2), 'track');
      if (s.value > 0.01) part(() => rr(ctx, 0, 0, Math.max(h, w * s.value), h, h / 2), 'fill');
      return 'control';
    case 'media': return 'media';
    default: return 'text';
  }
}
// #endregion parts

// #region grab
// The element's picture as a plain canvas. The wrapper's canvas draws the element (and anything the skin
// drew before), the whole canvas is copied with drawImage(), and the wrapper's canvas is cleared. The
// answer has the shape glass() and shade() take: { image, sx, sy, sw, sh } in pixels, and the CSS box it covers.
let pad = null;
export function grab(ctx, f, options) {
  const c = ctx.canvas;
  pad ??= document.createElement('canvas');
  if (pad.width < c.width) pad.width = c.width;        // it only grows
  if (pad.height < c.height) pad.height = c.height;
  if (options !== false) f.draw(options);
  const p = pad.getContext('2d');
  p.clearRect(0, 0, c.width, c.height);
  p.drawImage(c, 0, 0);
  ctx.save(); ctx.resetTransform(); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
  return { image: pad, sx: 0, sy: 0, sw: c.width, sh: c.height, x: -f.bleed, y: -f.bleed, width: c.width / f.scale, height: c.height / f.scale };
}
// #endregion grab

// #region cells
// The picture in `shot` (from grab()) as a grid of cells, each cell cut to the shape in `tile`: a cross
// for a stitch, a disc for a lamp. The picture is drawn small, enlarged with no smoothing, and the tile,
// repeated, is used as a mask.
let small = null;
const tiles = new Map();
export function maskTile(name, draw, size = 32) {
  if (!tiles.has(name)) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.scale(size, size); draw(x);
    tiles.set(name, c);
  }
  return tiles.get(name);
}
export function cells(ctx, f, shot, cell, tile, { boost = 2, shine = null, rows = 1 } = {}) {
  const k = f.scale, px = Math.max(2, Math.round(cell * k));       // one cell in canvas pixels
  const cols = Math.ceil(shot.sw / px), lines = Math.ceil(shot.sh / px);
  small ??= document.createElement('canvas');
  if (small.width < cols) small.width = cols;
  if (small.height < lines) small.height = lines;
  const s = small.getContext('2d');
  s.clearRect(0, 0, cols, lines);
  s.drawImage(shot.image, 0, 0, cols * px, lines * px, 0, 0, cols, lines);
  const show = Math.ceil(lines * clamp(rows));
  ctx.save();
  ctx.resetTransform();
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < boost; i++) ctx.drawImage(small, 0, 0, cols, show, 0, 0, cols * px, show * px);
  const fill = (image, mode) => {
    const pattern = ctx.createPattern(image, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(px / image.width));
    ctx.globalCompositeOperation = mode; ctx.fillStyle = pattern; ctx.fillRect(0, 0, cols * px, lines * px);
  };
  fill(tile, 'destination-in');
  if (shine) fill(shine, 'source-atop');
  ctx.restore();
  return { cell: px / k, cols, lines };
}
// #endregion cells

// #region shapes
// The same shapes as parts(), as boxes: [{ role, x, y, w, h, r }] and, for a line, { role: 'mark', path }.
// A skin that runs a shader over each shape needs the box. Returns what is left to draw:
// 'picture' (button, field, card), 'control', 'media' or 'text'.
export function shapes(ctx, f, { radius = 8, pill = false } = {}) {
  const { width: w, height: h, kind, state: s } = f;
  const list = [], box = (role, x, y, ww, hh, r) => list.push({ role, x, y, w: ww, h: hh, r });
  const disc = (role, cx, cy, r) => box(role, cx - r, cy - r, 2 * r, 2 * r, r);
  let rest = 'control';
  switch (kind) {
    case 'button': box(f.primary ? 'primary' : 'body', 0, 0, w, h, pill ? h / 2 : radius); rest = 'picture'; break;
    case 'field': box('well', 0, 0, w, h, radius); if (isSelect(f)) list.push({ role: 'mark', path: () => chevronPath(ctx, f) }); rest = 'picture'; break;
    case 'card': box('frame', 0, 0, w, h, radius + 4); rest = 'picture'; break;
    case 'check': box(s.on > 0.5 ? 'fill' : 'well', 2, 2, w - 4, h - 4, Math.min(radius, 6)); if (s.on > 0.05) list.push({ role: 'mark', path: () => tickPath(ctx, 2, 2, w - 4, s.on) }); break;
    case 'radio': disc('well', w / 2, h / 2, h / 2 - 2); if (s.on > 0.05) disc('dot', w / 2, h / 2, (h / 2 - 7) * s.on); break;
    case 'switch': box(s.on > 0.5 ? 'fill' : 'track', 0, 2, w, h - 4, h / 2); disc('knob', knobX(f, s.on), h / 2, h / 2 - 4); break;
    case 'range': { const x = knobX(f, s.value); box('track', 0, h / 2 - 4, w, 8, 4); if (x > 4) box('fill', 0, h / 2 - 4, x, 8, 4); disc('knob', x, h / 2, h / 2 - 1); break; }
    case 'bar': box('track', 0, 0, w, h, h / 2); if (s.value > 0.01) box('fill', 0, 0, Math.max(h, w * s.value), h, h / 2); break;
    case 'media': rest = 'media'; break;
    default: rest = 'text';
  }
  return { list, rest };
}
// #endregion shapes
