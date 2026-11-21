// Shared by the demos on /element-ideas/: one paint loop per canvas and a few drawing helpers.

let missed = false;

// #region mount
// Calls paint(ctx, width, height, time) in CSS pixels on every `paint` event.
// Return true from paint to ask for another frame; frames stop while the canvas is off screen.
export function mount(canvas, paint) {
  const ctx = canvas.getContext('2d');
  let visible = false, queued = 0, retries = 0;
  const request = () => canvas.requestPaint?.();
  canvas.addEventListener('paint', () => {
    const dpr = canvas.width / canvas.clientWidth || 1;
    ctx.reset();
    ctx.scale(dpr, dpr);
    missed = false;
    let again = paint(ctx, canvas.clientWidth, canvas.clientHeight, performance.now());
    // An element has no picture until the browser has painted it once. Try again next frame.
    if (missed && retries++ < 60) again = true; else if (!missed) retries = 0;
    if (again && visible && !queued) queued = requestAnimationFrame(() => { queued = 0; request(); });
  });
  new ResizeObserver(([e]) => {
    const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: canvas.clientWidth * devicePixelRatio, blockSize: canvas.clientHeight * devicePixelRatio };
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); }).observe(canvas);
  return { ctx, canvas, request };
}

// drawElementImage() draws the element and puts its hit region where it was drawn.
export function put(ctx, el, x = 0, y = 0) {
  try { ctx.drawElementImage(el, x, y); return true; } catch { missed = true; return false; }
}

// Place the hit region without drawing: an invisible draw still moves it.
export function hitOnly(ctx, el, x = 0, y = 0) {
  ctx.save();
  ctx.globalAlpha = 0;
  put(ctx, el, x, y);
  ctx.restore();
}

// An element that is not drawn this frame keeps the hit region of its last draw. Shrink that region to a
// point in the middle of the canvas. (Moving it far away works for hit testing, but focusing the element
// then scrolls the page towards the far place.)
export function park(canvas, el) {
  const at = new DOMMatrix().translate(canvas.clientWidth / 2, canvas.clientHeight / 2).scale(0.001);
  try { canvas.updateElementGeometry?.(el, { canvasTransform: at }); } catch {}
}
// #endregion mount

export function colors(el) {
  const s = getComputedStyle(el);
  const v = (n) => s.getPropertyValue(n).trim();
  return { fg: v('--fg'), bg: v('--bg'), card: v('--card'), line: v('--line'), accent: v('--accent'), muted: v('--muted'), ok: v('--ok'), bad: v('--bad') };
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const back = (t) => { t = clamp(t); const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// Run fn(progress 0..1) once per frame for ms milliseconds. Returns a function that cancels it.
export function tween(ms, fn, done) {
  let raf = 0;
  const t0 = performance.now();
  const step = (t) => {
    const p = clamp((t - t0) / ms);
    fn(p);
    if (p < 1) raf = requestAnimationFrame(step); else done?.();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
