// stage-2d.js: a paint loop and a few drawing helpers for a 2D canvas that draws its own HTML children.
// Used by /sort-table/, /accordion/, /minimap/, /tab-fan/ and /heat-map/. Started as a copy of
// /element-ideas/kit.js. Differences: every draw passes a width and height, a canvas with no API or a lost
// context falls back to plain HTML, and mount() takes the canvas size from device pixels.
//
//   const stage = mount(canvas, (ctx, width, height, time) => { ...; return true to draw again next frame; });
//   stage.request()                 ask for one paint
//   put(ctx, el, x, y, w?, h?)      drawElementImage() with a size. The hit region of el goes where it is drawn.
//   hitOnly(ctx, el, x, y)          move the hit region without drawing
//   park(canvas, el)                take an element that is not drawn out of hit testing
//   snapshot(canvas, el)            an ElementImage of el as it looks now, or null
//   toPlain(canvas, note)           give up on the canvas: show its children as ordinary HTML with a note

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

let missed = false;

// #region mount
export function mount(canvas, paint, { onLost } = {}) {
  if (!supported) { toPlain(canvas, 'This browser has no HTML-in-canvas API. The elements are shown as plain HTML.'); return { canvas, request() {}, plain: true }; }
  const ctx = canvas.getContext('2d');
  let visible = false, queued = 0, retries = 0, lost = false;
  const request = () => { if (!lost) canvas.requestPaint?.(); };
  canvas.addEventListener('paint', () => {
    if (lost || !canvas.clientWidth) return;
    const dpr = canvas.width / canvas.clientWidth || 1;
    ctx.reset();
    ctx.scale(dpr, dpr);                         // draw in CSS pixels from here on
    missed = false;
    let again = paint(ctx, canvas.clientWidth, canvas.clientHeight, performance.now());
    // An element has no picture until the browser has painted it once. Try again next frame.
    if (missed && retries++ < 60) again = true; else if (!missed) retries = 0;
    if (again && visible && !queued) queued = requestAnimationFrame(() => { queued = 0; request(); });
  });
  new ResizeObserver(([e]) => {
    const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: Math.round(canvas.clientWidth * devicePixelRatio), blockSize: Math.round(canvas.clientHeight * devicePixelRatio) };
    if (!box.inlineSize || !box.blockSize) return;
    // Assigning width or height clears the canvas, so do it only when the size changed.
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas, { box: 'device-pixel-content-box' });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); }).observe(canvas);
  // A lost 2D context leaves live, invisible controls in an empty box. Wait for the browser to restore it
  // (shared/context-guard.js asks for a paint then). If it stays lost, show the children as plain HTML.
  canvas.addEventListener('contextlost', () => {
    lost = true;
    setTimeout(() => {
      if (!lost) return;
      toPlain(canvas, 'The canvas lost its drawing context. The elements are shown as plain HTML.');
      onLost?.();
    }, 1500);
  });
  canvas.addEventListener('contextrestored', () => { lost = false; request(); });
  return { ctx, canvas, request, plain: false };
}

// drawElementImage() draws the element and puts its hit region where it was drawn.
export function put(ctx, el, x = 0, y = 0, w = el.offsetWidth, h = el.offsetHeight) {
  try { ctx.drawElementImage(el, x, y, w, h); return true; } catch { missed = true; return false; }
}

// Place the hit region without drawing: a draw with no alpha still moves it.
export function hitOnly(ctx, el, x = 0, y = 0, w = el.offsetWidth, h = el.offsetHeight) {
  ctx.save();
  ctx.globalAlpha = 0;
  put(ctx, el, x, y, w, h);
  ctx.restore();
}

// An element that is not drawn this frame keeps the hit region of its last draw. Shrink that region to a
// point inside the canvas. (A region outside the canvas makes focus scroll the page, and in Chromium 157
// some elements parked outside came back with empty pictures.)
export function park(canvas, el, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
  try { canvas.updateElementGeometry?.(el, { canvasTransform: new DOMMatrix().translate(x, y).scale(0.001) }); } catch {}
}

// A picture of the element as it is now. It can be drawn later, after the element has changed.
export function snapshot(canvas, el) {
  try { return canvas.captureElementImage?.(el) ?? null; } catch { return null; }
}
// #endregion mount

export function toPlain(canvas, note) {
  if (canvas.dataset.plain) return;
  canvas.dataset.plain = '1';
  const box = document.createElement('div');
  box.className = `${canvas.className} plain-fallback`;
  box.style.cssText = 'height:auto;min-height:0;overflow:auto;padding:8px';
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = note;
  box.append(p, ...canvas.childNodes);
  canvas.after(box);
  canvas.hidden = true;
  canvas.style.display = 'none';
}

export function colors(el) {
  const s = getComputedStyle(el);
  const v = (n) => s.getPropertyValue(n).trim();
  return { fg: v('--fg'), bg: v('--bg'), card: v('--card'), line: v('--line'), accent: v('--accent'), muted: v('--muted') };
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
export const back = (t) => { t = clamp(t); const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fraction of the pixels in a rectangle (CSS pixels) that are not transparent. For live checks.
export function inkIn(ctx, x, y, w, h) {
  const k = ctx.canvas.width / ctx.canvas.clientWidth || 1;
  const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n / (d.length / 4);
}

// A canvas with the drawable attributes and the given children, on a fixture stage. For live checks.
export function fixtureCanvas(parent, html, width = 320, height = 240) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = width; cv.height = height;
  cv.style.cssText = `width:${width}px;height:${height}px;flex:none;display:block`;
  cv.innerHTML = html;
  parent.append(cv);
  return { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
}
