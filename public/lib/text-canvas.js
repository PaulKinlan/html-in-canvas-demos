// Helpers for 2D canvases that draw text elements (mark, kbd, output, time, pre) with drawElementImage().
// Used by /mark-pen/, /keycaps/, /split-flap/, /flip-clock/ and /typed-code/. No dependencies.

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

let missed = false;

// #region mount
// Calls paint(ctx, width, height, now, event) in CSS pixels on every `paint` event.
// Return true from paint to ask for one more frame. Frames stop while the canvas is off screen.
// The returned object counts what happened: paints, frames (requestAnimationFrame calls) and requests.
export function mount(canvas, paint) {
  const ctx = canvas.getContext('2d');
  const api = { ctx, canvas, paints: 0, frames: 0, requests: 0, visible: false, request };
  let queued = 0, retries = 0;
  function request() { api.requests++; canvas.requestPaint?.(); }
  canvas.addEventListener('paint', (event) => {
    api.paints++;
    const dpr = canvas.width / canvas.clientWidth || 1;
    ctx.reset();
    ctx.scale(dpr, dpr);
    missed = false;
    let again = paint(ctx, canvas.clientWidth, canvas.clientHeight, performance.now(), event);
    // An element has no picture until the browser has painted it once. Try again next frame.
    if (missed && retries++ < 60) again = true; else if (!missed) retries = 0;
    if (again && api.visible && !queued) {
      api.frames++;
      queued = requestAnimationFrame(() => { queued = 0; request(); });
    }
  });
  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0] ??
      { inlineSize: Math.round(canvas.clientWidth * devicePixelRatio), blockSize: Math.round(canvas.clientHeight * devicePixelRatio) };
    // Assigning width or height clears the canvas, so assign only when the size changed.
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => { api.visible = entry.isIntersecting; if (api.visible) request(); }).observe(canvas);
  return api;
}
// #endregion mount

// #region draw
// Draw an element at its layout size. This also puts its hit region at (x, y).
export function draw(ctx, el, x = 0, y = 0) {
  try { ctx.drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight); return true; } catch { missed = true; return false; }
}

// Draw one rectangle of an element (or of a snapshot from captureElementImage) somewhere else.
// The source rectangle is in CSS pixels of the element.
export function piece(ctx, source, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) {
  if (sw <= 0 || sh <= 0) return true;
  try { ctx.drawElementImage(source, sx, sy, sw, sh, dx, dy, dw, dh); return true; } catch { missed = true; return false; }
}

// The last draw of an element decides where its hit region and its client rects are. After drawing
// pieces, call home() so that clicks, selection and getClientRects() match the layout position again.
// A draw with alpha 0 moves the hit region and leaves the pixels alone.
export function home(ctx, el, x = 0, y = 0) {
  ctx.save();
  ctx.globalAlpha = 0;
  draw(ctx, el, x, y);
  ctx.restore();
}
// #endregion draw

// #region boxes
// One box per character of the element's text, relative to the element's border box, in layout pixels.
// getClientRects() reports where the element was last drawn, at the scale it was drawn with, so the
// boxes are measured against the element's own rect and divided by the drawn scale.
export function charBoxes(el) {
  const base = el.getBoundingClientRect();
  const kx = base.width ? el.offsetWidth / base.width : 1, ky = base.height ? el.offsetHeight / base.height : 1;
  const range = new Range(), out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.data;
    for (let i = 0; i < text.length;) {
      const size = text.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + size);
      const r = range.getClientRects()[0];
      out.push({ ch: text.substr(i, size), node, index: i,
        x: r ? (r.x - base.x) * kx : 0, y: r ? (r.y - base.y) * ky : 0, w: r ? r.width * kx : 0, h: r ? r.height * ky : 0 });
      i += size;
    }
  }
  return out;
}

// The line boxes of an inline element or a Range (one per line it covers), relative to `root`.
export function lineBoxes(target, root) {
  const base = root.getBoundingClientRect();
  const kx = base.width ? root.offsetWidth / base.width : 1, ky = base.height ? root.offsetHeight / base.height : 1;
  const lines = [];
  for (const r of target.getClientRects()) {
    if (r.width < 0.5) continue;
    const box = { x: (r.x - base.x) * kx, y: (r.y - base.y) * ky, w: r.width * kx, h: r.height * ky };
    // A child element inside the target adds its own rect on the same line. Merge them.
    const same = lines.find((l) => Math.abs(l.y - box.y) < box.h * 0.5);
    if (same) { const right = Math.max(same.x + same.w, box.x + box.w); same.x = Math.min(same.x, box.x); same.w = right - same.x; } else lines.push(box);
  }
  return lines;
}
// #endregion boxes

// #region flap
// One split-flap cell part way through a flip. t runs 0 to 1. oldFace() and newFace() draw the whole
// cell (x, y, w, h) as it was and as it will be. The top half of the old face falls forward over the
// first half of the flip; the bottom half of the new face comes down over the second half.
export function flap(ctx, t, x, y, w, h, oldFace, newFace) {
  const mid = y + h / 2;
  const half = (top, face) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 1, top ? y - 1 : mid, w + 2, h / 2 + 1);
    ctx.clip();
    face();
    ctx.restore();
  };
  if (t <= 0) { oldFace(); return; }
  if (t >= 1) { newFace(); return; }
  half(true, newFace);      // behind the falling flap: the top of the new face
  half(false, oldFace);     // not yet covered: the bottom of the old face
  const falling = t < 0.5;
  const s = Math.max(0.001, Math.abs(Math.cos(t * Math.PI)));
  ctx.save();
  ctx.translate(0, mid);
  ctx.scale(1, s);
  ctx.translate(0, -mid);
  half(falling, falling ? oldFace : newFace);
  // The flap gets darker as it turns away from the light.
  ctx.fillStyle = `rgb(0 0 0 / ${(1 - s) * 0.55})`;
  ctx.fillRect(x - 1, falling ? y - 1 : mid, w + 2, h / 2 + 1);
  ctx.restore();
}
// #endregion flap

// Without the API a canvas shows nothing, so move its children out and show them as plain HTML.
export function plain(canvas, note = 'This browser does not draw elements into a canvas, so the content is shown as plain HTML.') {
  const box = document.createElement('div');
  box.className = 'plain-html';
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = note;
  box.append(p, ...canvas.children);
  canvas.parentElement?.classList.add('is-plain');
  canvas.replaceWith(box);
  return box;
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

// A small seeded random number generator, so a hand-drawn stroke is the same on every frame.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// For live checks: a drawable canvas with its own markup on the page's test stage.
export async function fixtureCanvas(stage, html, width = 300, height = 120) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.style.cssText = `display:block;flex:none;width:${width}px;height:${height}px`;
  canvas.innerHTML = html;
  stage.append(canvas);
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // A page's own code may resize the canvas (mount() does), so the scale is read when it is used.
  const scale = () => canvas.width / width;
  const fx = {
    canvas, ctx, paints: 0, el: canvas.firstElementChild,
    paint: () => new Promise((resolve) => { canvas.addEventListener('paint', resolve, { once: true }); canvas.requestPaint(); }),
    // Wait for paint events the page did not ask for. Resolves with how many came.
    quiet: async (ms) => { const from = fx.paints; await new Promise((r) => setTimeout(r, ms)); return fx.paints - from; },
    start: () => { ctx.reset(); ctx.scale(scale(), scale()); },
    // Count pixels in a CSS-pixel rectangle that pass a test on (r, g, b, a).
    count: (x, y, w, h, test = (r, g, b, a) => a > 24) => {
      const k = scale();
      const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
      return n;
    },
  };
  canvas.addEventListener('paint', () => { fx.paints++; });
  // The first paint event comes once the children have a picture.
  await fx.paint();
  await new Promise((r) => setTimeout(r, 60));
  await fx.paint();
  return fx;
}
