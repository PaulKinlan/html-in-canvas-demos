// Shared by the demos on /paint-clocks/: one paint handler per canvas and a few drawing helpers.
// Adapted from /form-state/kit.js, with the frame loop taken out.

let missed = false;

// #region mount
// Calls paint(ctx, width, height, time, event) in CSS pixels on every `paint` event, and does nothing else.
// There is no requestAnimationFrame(), no timer and no requestPaint() loop here: after the first paint,
// which is asked for once when the canvas gets its size, a frame is drawn only when the browser raises
// `paint` because an element in the canvas repainted.
export function mount(canvas, paint) {
  const off = { ctx: null, canvas, request() {}, plain: true, rate: () => 0, count: () => 0 };
  if (isPlain()) { plain(canvas); return off; }
  const ctx = canvas.getContext('2d');
  if (!ctx) { plain(canvas, 'gave no 2D context'); return off; }
  let dead = false, count = 0, retries = 0;
  const times = [];
  const request = () => { if (!dead) canvas.requestPaint?.(); };
  canvas.addEventListener('paint', (event) => {
    if (dead || ctx.isContextLost?.()) return;
    const now = performance.now(), dpr = canvas.width / canvas.clientWidth || 1;
    count++; times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    ctx.reset();
    ctx.scale(dpr, dpr);
    missed = false;
    paint(ctx, canvas.clientWidth, canvas.clientHeight, now, event);
    // The one exception: an element has no picture until the browser has painted it once, so a draw that
    // failed for that reason is tried again, at most 30 times.
    if (missed && retries++ < 30) request();
  });
  // #endregion mount
  // #region lost
  // The first time any canvas on the page loses its context, every demo stops drawing and shows its
  // controls as plain HTML. The page does not draw again until the reader asks, so a device that cannot
  // keep the canvas does not lose it over and over.
  const stop = (why) => { if (dead) return; dead = true; plain(canvas, why); };
  canvas.addEventListener('contextlost', () => { remember(); dispatchEvent(new Event('paint-clocks-plain')); stop('lost its context'); });
  addEventListener('paint-clocks-plain', () => stop('was stopped because another canvas on this page lost its context'));
  // #endregion lost
  new ResizeObserver(([e]) => {
    if (dead) return;
    const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: canvas.clientWidth * devicePixelRatio, blockSize: canvas.clientHeight * devicePixelRatio };
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas);
  // rate(): paint events in the last second. count(): paint events so far.
  return { ctx, canvas, request, plain: false, rate: () => times.filter((t) => performance.now() - t <= 1000).length, count: () => count };
}

// #region plain
const KEY = 'paint-clocks-plain';
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

// #region ticked
// Did this paint event come from the clock element? Drawing an element at a new place raises a second
// paint event one frame later, with that element in changedElements (measured in Chromium 157). Those
// echo events must not count as ticks, or every effect would run at twice the rate of its clock.
export function ticked(event, ...clocks) {
  const changed = event?.changedElements;
  if (!changed) return true;
  return clocks.some((el) => [...changed].some((c) => c === el || el.contains(c)));
}
// Counts ticks: rate() is the number in the last second.
export function meter() {
  const times = [];
  let total = 0;
  return {
    tick(now) { total++; times.push(now); while (times.length && now - times[0] > 1000) times.shift(); },
    rate: () => times.filter((t) => performance.now() - t <= 1000).length,
    get total() { return total; },
  };
}
// #endregion ticked

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
