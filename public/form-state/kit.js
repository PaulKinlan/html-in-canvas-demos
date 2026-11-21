// Shared by the demos on /form-state/: one paint loop per canvas and a few drawing helpers.
// A copy of /instruments/kit.js, so that this folder does not depend on that page.

let missed = false;

// #region mount
// Calls paint(ctx, width, height, time, event) in CSS pixels on every `paint` event.
// Return true from paint to ask for another frame; frames stop while the canvas is off screen.
export function mount(canvas, paint) {
  const off = { ctx: null, canvas, request() {}, plain: true };
  if (isPlain()) { plain(canvas); return off; }
  const ctx = canvas.getContext('2d');
  if (!ctx) { plain(canvas, 'gave no 2D context'); return off; }
  let visible = false, queued = 0, retries = 0, dead = false;
  const request = () => { if (!dead) canvas.requestPaint?.(); };
  canvas.addEventListener('paint', (event) => {
    if (dead || ctx.isContextLost?.()) return;
    const dpr = canvas.width / canvas.clientWidth || 1;
    ctx.reset();
    ctx.scale(dpr, dpr);
    missed = false;
    let again = paint(ctx, canvas.clientWidth, canvas.clientHeight, performance.now(), event);
    // An element has no picture until the browser has painted it once. Try again next frame.
    if (missed && retries++ < 60) again = true; else if (!missed) retries = 0;
    if (again && visible && !queued) queued = requestAnimationFrame(() => { queued = 0; request(); });
  });
  // #endregion mount
  // #region lost
  // The first time any canvas on the page loses its context, every demo stops drawing and shows its
  // controls as plain HTML. The page does not draw again until the reader asks, so a device that cannot
  // keep the canvas does not lose it over and over.
  const stop = (why) => { if (dead) return; dead = true; cancelAnimationFrame(queued); plain(canvas, why); };
  canvas.addEventListener('contextlost', () => { remember(); dispatchEvent(new Event('form-state-plain')); stop('lost its context'); });
  addEventListener('form-state-plain', () => stop('was stopped because another canvas on this page lost its context'));
  // #endregion lost
  new ResizeObserver(([e]) => {
    if (dead) return;
    const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: canvas.clientWidth * devicePixelRatio, blockSize: canvas.clientHeight * devicePixelRatio };
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); }).observe(canvas);
  return { ctx, canvas, request, plain: false };
}

// #region plain
const KEY = 'form-state-plain';
const isPlain = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = () => { try { sessionStorage.setItem(KEY, '1'); } catch {} };

// Take the controls out of the canvas and show them where it was. They are ordinary form controls,
// so every demo still works, without its drawing.
export function plain(canvas, why) {
  if (canvas.hidden) return;
  const box = document.createElement('div');
  box.className = 'plain-controls';
  box.style.minHeight = `${canvas.clientHeight}px`;
  const note = document.createElement('p');
  note.className = 'plain-note';
  note.textContent = why
    ? `The canvas ${why}, so these are the plain controls. ${window.__gfx?.summary?.() ?? ''}`
    : 'A canvas on this page lost its context earlier, so these are the plain controls.';
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Draw in the canvas again';
  again.addEventListener('click', () => { try { sessionStorage.removeItem(KEY); } catch {} location.reload(); });
  box.append(...canvas.childNodes, note, again);
  canvas.hidden = true;
  canvas.after(box);
}
// #endregion plain

// drawElementImage() draws the element and puts its hit region where it was drawn.
export function put(ctx, el, x = 0, y = 0) {
  try { ctx.drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight); return true; } catch { missed = true; return false; }
}

// Say where input goes without drawing: a draw that is clipped away completely still moves the hit region.
export function place(ctx, el, x = 0, y = 0) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip();
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
