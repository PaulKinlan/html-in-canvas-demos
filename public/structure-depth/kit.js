// Shared by the six demos on /structure-depth/: one paint loop per canvas and the drawing helpers.
// The paint loop started as a copy of /instruments/kit.js, so that this folder does not depend on that page.

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

let missed = false;

// #region mount
// Calls paint(ctx, width, height, time) in CSS pixels on every `paint` event.
// Return true from paint to ask for another frame. Frames stop while the canvas is off screen.
export function mount(canvas, paint) {
  const off = { ctx: null, canvas, request() {}, hit() {}, plain: true };
  if (!supported) { plain(canvas, 'none'); return off; }
  if (isPlain()) { plain(canvas); return off; }
  const ctx = canvas.getContext('2d');
  if (!ctx) { plain(canvas, 'gave no 2D context'); return off; }
  let visible = false, queued = 0, retries = 0, dead = false, moving = false;
  const request = () => { if (!dead) canvas.requestPaint?.(); };
  const scale = () => canvas.width / canvas.clientWidth || 1;
  canvas.addEventListener('paint', () => {
    if (dead || ctx.isContextLost?.() || !canvas.clientWidth) return;
    const dpr = scale();
    ctx.reset();
    ctx.scale(dpr, dpr);
    missed = false;
    let again = paint(ctx, canvas.clientWidth, canvas.clientHeight, performance.now());
    // An element has no picture until the browser has painted it once. Try again next frame.
    if (missed && retries++ < 60) again = true; else if (!missed) retries = 0;
    // Chromium 157 remembers the hit-test answer for a point until an attribute changes. When the
    // drawing comes to rest, toggle one attribute so that the next tap is tested against the final places.
    if (moving && !again) for (const el of canvas.querySelectorAll('[drawable]')) el.toggleAttribute('data-rest');
    moving = !!again;
    if (again && visible && !queued) queued = requestAnimationFrame(() => { queued = 0; request(); });
  });
  // #endregion mount
  // #region hit
  // Put the hit region of el at a matrix given in CSS pixels of the canvas, without drawing anything:
  // a draw with no alpha moves the region. This also works outside a `paint` event, so a pointerdown
  // handler can move the region before the browser decides what the tap landed on.
  const hit = (el, matrix) => {
    if (dead) return false;
    const dpr = scale();
    ctx.save();
    ctx.setTransform(new DOMMatrix().scale(dpr).multiply(matrix));
    ctx.globalAlpha = 0;
    let ok = true;
    try { ctx.drawElementImage(el, 0, 0, el.offsetWidth, el.offsetHeight); } catch { ok = false; }
    ctx.restore();
    return ok;
  };
  // #endregion hit
  // #region lost
  // The first time any canvas on the page loses its context, every demo stops drawing and shows its
  // elements as plain HTML. The page does not draw again until the reader asks.
  const stop = (why) => { if (dead) return; dead = true; cancelAnimationFrame(queued); plain(canvas, why); };
  canvas.addEventListener('contextlost', (e) => { if (e.isTrusted) remember(); dispatchEvent(new Event(EVENT)); stop('lost its context'); });
  addEventListener(EVENT, () => stop('was stopped because another canvas on this page lost its context'));
  // #endregion lost
  new ResizeObserver(([e]) => {
    if (dead) return;
    const box = e.devicePixelContentBoxSize?.[0] ?? { inlineSize: Math.round(canvas.clientWidth * devicePixelRatio), blockSize: Math.round(canvas.clientHeight * devicePixelRatio) };
    if (!box.inlineSize || !box.blockSize) return;
    // Assigning width or height clears the canvas, so do it only when the size changed.
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    request();
  }).observe(canvas, { box: 'device-pixel-content-box' });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); }).observe(canvas);
  return { ctx, canvas, request, hit, plain: false };
}

// #region plain
const KEY = 'structure-depth-plain', EVENT = 'structure-depth-plain';
const isPlain = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = () => { try { sessionStorage.setItem(KEY, '1'); } catch {} };

// Take the elements out of the canvas and show them where it was. They are ordinary sections, links,
// details and asides, so the content is all there without the drawing.
export function plain(canvas, why) {
  if (canvas.hidden) return;
  const box = document.createElement('div');
  box.className = 'plain-html';
  const note = document.createElement('p');
  note.className = 'plain-note';
  box.append(...canvas.childNodes, note);
  if (why === 'none') note.textContent = 'This browser has no HTML-in-canvas API, so this is the plain HTML.';
  else {
    note.textContent = why
      ? `The canvas ${why}, so this is the plain HTML. ${window.__gfx?.summary?.() ?? ''}`
      : 'A canvas on this page lost its context earlier, so this is the plain HTML.';
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Draw in the canvas again';
    again.addEventListener('click', () => { try { sessionStorage.removeItem(KEY); } catch {} location.reload(); });
    box.append(again);
  }
  canvas.hidden = true;
  canvas.parentElement.classList.add('is-plain');
  canvas.after(box);
}
// #endregion plain

// drawElementImage() draws the element and puts its hit region where it was drawn.
export function put(ctx, el, x = 0, y = 0, w = el.offsetWidth, h = el.offsetHeight) {
  try { ctx.drawElementImage(el, x, y, w, h); return true; } catch { missed = true; return false; }
}

// The hit region alone, under the current transform of ctx.
export function hitOnly(ctx, el, x = 0, y = 0) {
  ctx.save();
  ctx.globalAlpha = 0;
  put(ctx, el, x, y);
  ctx.restore();
}

// An element that is not drawn this frame keeps the hit region of its last draw. Shrink that region to a
// point in the middle of the canvas. (A region far outside the canvas makes focus scroll the page.)
export function park(canvas, el) {
  const at = new DOMMatrix().translate(canvas.clientWidth / 2, canvas.clientHeight / 2).scale(0.001);
  try { canvas.updateElementGeometry?.(el, { canvasTransform: at }); } catch {}
}

// A picture of the element as it is now. It can be drawn after the element has changed.
export function snapshot(canvas, el) {
  try { return canvas.captureElementImage?.(el) ?? null; } catch { return null; }
}

// #region strips
// A 2D context has affine transforms only. Perspective is made by drawing the element many times,
// each time clipped to a narrow strip with its own scale.

// Vertical strips, for a face turned about a vertical axis. project(x) returns [screen x, scale] for a
// column x of the element (0 to W). Each strip is scaled vertically about y = 0, where the middle of the
// element is put.
export function columns(ctx, el, W, H, n, project) {
  for (let i = 0; i < n; i++) {
    const x0 = W * i / n, x1 = W * (i + 1) / n;
    const [sx0, s0] = project(x0), [sx1, s1] = project(x1);
    if (sx1 - sx0 < 0.05) continue;
    const sx = (sx1 - sx0) / (x1 - x0), sy = (s0 + s1) / 2;
    ctx.save();
    ctx.transform(sx, 0, 0, sy, sx0 - x0 * sx, -H / 2 * sy);
    ctx.beginPath(); ctx.rect(x0, 0, W / n + 0.5 / sx, H); ctx.clip();
    put(ctx, el, 0, 0, W, H);
    ctx.restore();
  }
}

// Horizontal strips folded like paper, for an element that folds away upwards. `shown` is the fraction
// of the height H that is left (1 is flat, 0 is folded shut). Each strip is squashed and sheared, odd
// strips the other way, and shaded.
export function concertina(ctx, el, W, H, shown, n = 4) {
  const sh = H / n, lean = Math.sqrt(1 - shown * shown), amp = 9 * lean;
  for (let i = 0; i < n; i++) {
    const odd = i % 2 === 1;
    ctx.save();
    ctx.translate((odd ? amp : 0) - amp / 2, i * sh * shown);
    ctx.transform(1, 0, (odd ? -amp : amp) / sh, shown, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, W, sh + 0.5); ctx.clip();
    put(ctx, el, 0, -i * sh, W, H);
    ctx.fillStyle = odd ? `rgb(0 0 0 / ${0.38 * lean})` : `rgb(255 255 255 / ${0.14 * lean})`;
    ctx.fillRect(0, 0, W, sh + 0.5);
    ctx.restore();
  }
}
// #endregion strips

// #region point
// Call fn(x, y, event) with canvas coordinates in CSS pixels: on every pointerdown, before the element
// under the pointer has handled it, and on every move of a mouse. Demos that show one element in
// several pieces use it to put the element's one hit region on the piece under the pointer.
export function onPoint(canvas, fn) {
  const at = (e) => { const r = canvas.getBoundingClientRect(); fn(e.clientX - r.left, e.clientY - r.top, e); };
  canvas.addEventListener('pointerdown', at, true);
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) at(e); }, true);
}
// #endregion point

// #region scroll
// A canvas that stays in place inside a native scroller. The scroller holds the canvas (position:
// sticky) and an empty spacer, so the browser scrolls it by touch, wheel and keyboard. The canvas
// draws the content at -scrollTop.
export function scrollRange(scroller, canvas, content, extra = 0) {
  const spacer = scroller.querySelector('.spacer');
  const size = () => { spacer.style.height = `${Math.max(0, content.offsetHeight + extra - canvas.clientHeight)}px`; };
  new ResizeObserver(size).observe(content);
  size();
}
// #endregion scroll

export function colors(el) {
  const s = getComputedStyle(el);
  const v = (n) => s.getPropertyValue(n).trim();
  return { fg: v('--fg'), bg: v('--bg'), card: v('--card'), line: v('--line'), accent: v('--accent'), muted: v('--muted') };
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const interactive = (target) => !!target.closest?.('a, button, input, select, textarea, label, summary');
