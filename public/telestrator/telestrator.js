// telestrator.js: a <video> and a layer of DOM annotations composed in one 2D canvas.
//
//   import { compose, Annotations } from '/telestrator/telestrator.js';
//
//   <canvas content="drawable" layoutsubtree width="640" height="360">
//     <div id="picture" drawable><video></video></div>     the frame
//     <div id="layer" class="tele-layer" drawable></div>   the annotations
//   </canvas>
//
//   const notes = new Annotations(layer, { w: 640, h: 360, video });
//   compose(canvas, { picture, layer, video, notes });
//   notes.redact(200, 120, 160, 60);      // a <div>; the video under it is pixelated in the canvas
//   notes.lens(420, 180, 60);             // a <div>; the video under it is drawn 2.2 times larger
//
// The annotations are elements. The paint handler reads their boxes and changes the video
// pixels under them with drawImage(video, sx, sy, …) before it draws the layer on top.

const SVG = 'http://www.w3.org/2000/svg';
export const ZOOM = 2.2;

/** Where a video drawn with object-fit: contain lies in a w by h scene. `s` is scene pixels per video pixel. */
export function videoBox(video, w, h) {
  const vw = video?.videoWidth, vh = video?.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(w / vw, h / vh);
  return { x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s, s };
}

// #region paint
/**
 * Draw the frame, the effects of the annotations on the frame, then the annotations.
 * `notes.redactStyle` is 'pixels', 'blur' or 'black'.
 */
export function compose(canvas, { picture, layer, video, notes }) {
  const ctx = canvas.getContext('2d');
  const cells = document.createElement('canvas').getContext('2d');
  const { w, h } = notes;

  /** Draw the part of the video that lies under scene rectangle `s` into scene rectangle `d`. */
  const region = (box, s, d) => ctx.drawImage(video, (s.x - box.x) / box.s, (s.y - box.y) / box.s, s.w / box.s, s.h / box.s, d.x, d.y, d.w, d.h);

  /** Draw scene rectangle `s` of the video into `d` so that it cannot be read. */
  function hide(box, s, d, k) {
    ctx.fillStyle = '#000';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    if (!box || notes.redactStyle === 'black') return;
    if (notes.redactStyle === 'blur') {
      ctx.save();
      ctx.beginPath(); ctx.rect(d.x, d.y, d.w, d.h); ctx.clip();
      ctx.filter = `blur(${(10 * k * d.w) / s.w}px)`;
      region(box, s, d);
      ctx.restore();
      return;
    }
    // Pixels: scale the region down to one pixel per 14 px cell, then up again with no smoothing.
    const nx = Math.max(1, Math.ceil(s.w / 14)), ny = Math.max(1, Math.ceil(s.h / 14));
    if (cells.canvas.width !== nx) cells.canvas.width = nx;
    if (cells.canvas.height !== ny) cells.canvas.height = ny;
    cells.drawImage(video, (s.x - box.x) / box.s, (s.y - box.y) / box.s, s.w / box.s, s.h / box.s, 0, 0, nx, ny);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cells.canvas, 0, 0, nx, ny, d.x, d.y, d.w, d.h);
    ctx.imageSmoothingEnabled = true;
  }

  canvas.addEventListener('paint', () => {
    const k = canvas.width / w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 1. The element that holds the <video>. The size makes it fill the buffer at any shown size.
    ctx.drawElementImage(picture, 0, 0, canvas.width, canvas.height);

    const box = videoBox(video, w, h);
    const spots = notes.of('spot'), lenses = notes.of('lens'), boxes = notes.of('redact').filter((g) => g.w > 1 && g.h > 1);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // 2. Spotlight: the frame again, grey and dark, everywhere outside the circles.
    if (spots.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      for (const g of spots) { ctx.moveTo(g.x + g.r, g.y); ctx.arc(g.x, g.y, g.r, 0, 2 * Math.PI); }
      ctx.clip('evenodd');
      if (box) { ctx.filter = 'grayscale(1) brightness(.35)'; ctx.drawImage(video, box.x, box.y, box.w, box.h); }
      else { ctx.fillStyle = 'rgb(0 0 0 / .65)'; ctx.fillRect(0, 0, w, h); }
      ctx.restore();
    }

    // 3. Magnifier: the video under each circle, drawn ZOOM times larger from the full-size frame.
    //    A redact box seen through the lens is hidden there too.
    for (const g of box ? lenses : []) {
      ctx.save();
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 2 * Math.PI); ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(g.x - g.r, g.y - g.r, 2 * g.r, 2 * g.r);
      region(box, { x: g.x - g.r / ZOOM, y: g.y - g.r / ZOOM, w: (2 * g.r) / ZOOM, h: (2 * g.r) / ZOOM }, { x: g.x - g.r, y: g.y - g.r, w: 2 * g.r, h: 2 * g.r });
      for (const b of boxes) hide(box, b, { x: g.x + (b.x - g.x) * ZOOM, y: g.y + (b.y - g.y) * ZOOM, w: b.w * ZOOM, h: b.h * ZOOM }, k);
      ctx.restore();
    }

    // 4. Redact: the pixels under each box are replaced before anything reads the canvas.
    for (const b of boxes) hide(box, b, b, k);

    // 5. The annotation layer: strokes, arrows, notes, markers and the frames of the tools above.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawElementImage(layer, 0, 0, canvas.width, canvas.height);
  });
  new ResizeObserver(() => canvas.requestPaint()).observe(canvas);
  canvas.requestPaint();
  return ctx;
}
// #endregion paint

// #region colour
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
probe.canvas.width = 64; probe.canvas.height = 36;

/**
 * The mean colour of the video under a list of scene points, and a glow colour with the same hue.
 * Resolves to null when the video has no frame or cannot be read.
 */
export function videoColour(video, points, w, h) {
  const box = videoBox(video, w, h);
  if (!box || !points.length) return null;
  let data;
  try {
    probe.drawImage(video, 0, 0, 64, 36);
    data = probe.getImageData(0, 0, 64, 36).data;
  } catch { return null; }
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(points.length / 24));
  for (let i = 0; i < points.length; i += step) {
    const u = (points[i].x - box.x) / box.w, v = (points[i].y - box.y) / box.h;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const at = (Math.floor(v * 36) * 64 + Math.floor(u * 64)) * 4;
    r += data[at]; g += data[at + 1]; b += data[at + 2]; n++;
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 0) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = Math.round(hue * 60 + 360) % 360;
  return { rgb: [Math.round(r), Math.round(g), Math.round(b)], hue, glow: d < 20 ? 'hsl(0 0% 100%)' : `hsl(${hue} 100% 62%)` };
}
// #endregion colour

// #region stroke
/**
 * The `d` of one stroke. Points are { x, y, p } with p the PointerEvent pressure.
 * If the pressure varies, the path is the outline of a ribbon whose width follows it, and it is filled.
 * If it does not (a mouse reports 0.5 for every point), the path is the centre line, and it is stroked.
 */
export function strokePath(points, width) {
  const f = (n) => n.toFixed(1);
  if (points.length === 1) return { d: `M${f(points[0].x)} ${f(points[0].y)}l.1 0`, ribbon: false, width: width * (0.5 + points[0].p) };
  let lo = 1, hi = 0;
  for (const p of points) { lo = Math.min(lo, p.p); hi = Math.max(hi, p.p); }
  if (hi - lo < 0.05) return { d: 'M' + points.map((p) => `${f(p.x)} ${f(p.y)}`).join('L'), ribbon: false, width: width * (0.5 + (points[0].p || 0.5)) };
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], p = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = (width * (0.25 + 1.75 * p.p)) / 2;
    left.push(`${f(p.x + nx * half)} ${f(p.y + ny * half)}`);
    right.unshift(`${f(p.x - nx * half)} ${f(p.y - ny * half)}`);
  }
  return { d: `M${left.join('L')}L${right.join('L')}Z`, ribbon: true, width: 1.5 };
}
// #endregion stroke

// #region annotations
/** The annotations of one layer. Every one is an element in `layer`; `el.geo` holds its place in scene pixels. */
export class Annotations {
  constructor(layer, { w = 640, h = 360, video = null } = {}) {
    Object.assign(this, { layer, w, h, video, redactStyle: 'pixels', items: [], steps: 0 });
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('aria-hidden', 'true');
    layer.append(this.svg);
  }

  /** The `geo` of every annotation of one kind. The paint handler calls this. */
  of(kind) { return this.items.filter((el) => el.dataset.kind === kind).map((el) => el.geo); }

  #add(el, kind, geo) {
    el.dataset.kind = kind;
    el.geo = geo;
    this.items.push(el);
    (el.namespaceURI === SVG ? this.svg : this.layer).append(el);
    this.place(el);
    return el;
  }

  /** Write `el.geo` to the element's style or path. */
  place(el) {
    const g = el.geo, kind = el.dataset.kind;
    if (kind === 'pen') {
      const s = strokePath(g.points, g.width);
      el.setAttribute('d', s.d);
      el.setAttribute('stroke-width', s.width.toFixed(1));
      el.setAttribute('fill', s.ribbon ? g.color : 'none');
      el.dataset.ribbon = s.ribbon;
    } else if (kind === 'arrow') {
      const a = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x), n = Math.min(22, Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) / 2);
      const wing = (t) => `${(g.b.x - n * Math.cos(a + t)).toFixed(1)} ${(g.b.y - n * Math.sin(a + t)).toFixed(1)}`;
      el.setAttribute('d', `M${g.a.x.toFixed(1)} ${g.a.y.toFixed(1)}L${g.b.x.toFixed(1)} ${g.b.y.toFixed(1)}M${wing(0.45)}L${g.b.x.toFixed(1)} ${g.b.y.toFixed(1)}L${wing(-0.45)}`);
    } else if (kind === 'spot' || kind === 'lens') {
      el.style.cssText = `left:${g.x - g.r}px;top:${g.y - g.r}px;width:${2 * g.r}px;height:${2 * g.r}px`;
    } else if (kind === 'redact') {
      el.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px`;
    } else {
      el.style.left = `${g.x}px`;
      el.style.top = `${g.y}px`;
    }
  }

  #path(kind, geo, { color = '#ffe14d', fade = false } = {}) {
    const el = document.createElementNS(SVG, 'path');
    el.setAttribute('stroke', color);
    el.setAttribute('fill', 'none');
    if (kind === 'arrow') el.setAttribute('stroke-width', geo.width);
    this.#add(el, kind, { ...geo, color });
    if (fade) this.fade(el);
    return el;
  }

  /** A freehand stroke: one SVG <path>. Call again with more points through `extend()`. */
  pen(points, { color, width = 5, fade = false } = {}) { return this.#path('pen', { points: [...points], width }, { color, fade }); }
  arrow(a, b, { color, width = 5, fade = false } = {}) { return this.#path('arrow', { a, b, width }, { color, fade }); }
  extend(el, point) { el.geo.points.push(point); this.place(el); }

  /** Give a stroke a glow in the colour of the video under it. */
  glow(el) {
    const g = el.geo;
    const colour = this.video && videoColour(this.video, g.points ?? [g.a, g.b, { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }], this.w, this.h);
    if (colour) { el.style.setProperty('--glow', colour.glow); el.dataset.under = colour.rgb.join(','); }
    return colour;
  }

  /** Start the CSS animation that fades a stroke, and remove the element when it ends. */
  fade(el, seconds = 4) {
    el.style.setProperty('--fade', `${seconds}s`);
    el.classList.add('fade');
    el.addEventListener('animationend', () => this.remove(el), { once: true });
  }

  /** A text note: a <textarea> with a bar to drag it by. */
  note(x, y, text = '') {
    const el = document.createElement('div');
    el.className = 'item note';
    el.innerHTML = '<span class="grip" aria-hidden="true"></span><textarea rows="2" spellcheck="false" aria-label="Note" placeholder="Type a note"></textarea>';
    el.querySelector('textarea').value = text;
    return this.#add(el, 'note', { x, y });
  }

  /** A numbered step marker. */
  step(x, y) {
    const el = document.createElement('div');
    el.className = 'item step';
    el.textContent = ++this.steps;
    return this.#add(el, 'step', { x, y });
  }

  #ring(kind, geo, label) {
    const el = document.createElement('div');
    el.className = `item ${kind}`;
    if (label) el.innerHTML = `<span>${label}</span>`;
    return this.#add(el, kind, geo);
  }
  /** The frame outside the circle is drawn grey and dark. */
  spot(x, y, r = 70) { return this.#ring('spot', { x, y, r }); }
  /** The video under the circle is drawn ZOOM times larger. */
  lens(x, y, r = 60) { return this.#ring('lens', { x, y, r }, `${ZOOM}×`); }
  /** The video under the box is pixelated, blurred or black. */
  redact(x, y, w, h) { return this.#ring('redact', { x, y, w, h }, 'hidden'); }

  move(el, dx, dy) {
    const g = el.geo;
    if (g.points) for (const p of g.points) { p.x += dx; p.y += dy; }
    else if (g.a) { g.a.x += dx; g.a.y += dy; g.b.x += dx; g.b.y += dy; }
    else { g.x += dx; g.y += dy; }
    this.place(el);
  }

  /** The stroke or arrow that passes within `max` scene pixels of a point. */
  strokeNear(x, y, max = 14) {
    const far = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    for (const el of [...this.items].reverse()) {
      const g = el.geo, pts = g.points ?? (g.a ? [g.a, g.b] : null);
      if (!pts) continue;
      for (let i = 0; i < pts.length; i++) if (far({ x, y }, pts[Math.max(0, i - 1)], pts[i]) <= max) return el;
    }
    return null;
  }

  remove(el) {
    const i = this.items.indexOf(el);
    if (i >= 0) this.items.splice(i, 1);
    el.remove();
  }
  undo() { const el = this.items.at(-1); if (el) this.remove(el); return el; }
  clear() { for (const el of [...this.items]) this.remove(el); this.steps = 0; }
}
// #endregion annotations
