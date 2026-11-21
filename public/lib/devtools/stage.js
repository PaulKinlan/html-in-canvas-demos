// Helpers shared by the developer tools in this folder. Each tool draws its
// overlay into the same 2D canvas that draws the elements, in CSS pixels.

// #region fit
/** Keep the canvas buffer at device pixels. `onChange` runs after the size changed. */
export function fitCanvas(canvas, onChange) {
  const observer = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    const w = box ? box.inlineSize : Math.round(canvas.clientWidth * devicePixelRatio);
    const h = box ? box.blockSize : Math.round(canvas.clientHeight * devicePixelRatio);
    let changed = false;
    // Assigning width or height clears the canvas, so assign only on a change.
    if (canvas.width !== w) { canvas.width = w; changed = true; }
    if (canvas.height !== h) { canvas.height = h; changed = true; }
    if (changed) onChange?.();
  });
  try { observer.observe(canvas, { box: 'device-pixel-content-box' }); } catch { observer.observe(canvas); }
  return observer;
}

/** Buffer pixels per CSS pixel. */
export const cssScale = (canvas) => (canvas.clientWidth ? canvas.width / canvas.clientWidth : 1);
// #endregion fit

// #region record
/**
 * Record every drawElementImage() call made on `ctx`: the element, and the
 * four corners it was drawn to in CSS pixels of the canvas. The browser does
 * not report where an element was drawn (getBoundingClientRect() gives only
 * the bounding box), so the tools read the transform at the time of the call.
 */
export function recordDraws(ctx) {
  const draws = [];
  const original = ctx.drawElementImage;
  ctx.drawElementImage = function (element, ...args) {
    // (element, dx, dy), (element, dx, dy, dw, dh) or (element, sx, sy, sw, sh, dx, dy, dw, dh)
    let [x, y, w, h] = args.length >= 8 ? args.slice(4) : args;
    w ??= element.offsetWidth;
    h ??= element.offsetHeight;
    const matrix = ctx.getTransform(), k = cssScale(ctx.canvas);
    const corner = (px, py) => { const p = matrix.transformPoint(new DOMPoint(px, py)); return { x: p.x / k, y: p.y / k }; };
    draws.push({ element, quad: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)], alpha: ctx.globalAlpha });
    return original.call(ctx, element, ...args);
  };
  return { draws, clear() { draws.length = 0; }, stop() { delete ctx.drawElementImage; } };
}
// #endregion record

/** Is the point inside the convex four-corner shape? */
export function inQuad(quad, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

export function quadPath(ctx, quad) {
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
}

/** A client rectangle in CSS pixels of the canvas. */
export function inCanvas(canvas, rect, origin = canvas.getBoundingClientRect()) {
  return { x: rect.left - origin.left - canvas.clientLeft, y: rect.top - origin.top - canvas.clientTop, width: rect.width, height: rect.height };
}

/** A label on a rounded plate. Returns its width. `x`, `y` is the top left corner. */
export function plate(ctx, text, x, y, { fill = '#10131f', color = '#fff', font = '600 11px ui-monospace, Menlo, Consolas, monospace', pad = 5, height = 18, maxX = Infinity, stroke = null } = {}) {
  ctx.save();
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  if (x + w > maxX) x = Math.max(0, maxX - w);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, height, 4);
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y + height / 2 + 0.5);
  ctx.restore();
  return w;
}

/** Diagonal stripes inside the current path's bounds `r` (clip first). */
export function hatch(ctx, r, color, gap = 6) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -r.height; d < r.width; d += gap) { ctx.moveTo(r.x + d, r.y + r.height); ctx.lineTo(r.x + d + r.height, r.y); }
  ctx.stroke();
  ctx.restore();
}

/** A short name for an element: its id, its label or its text. */
export function nameOf(el) {
  const text = (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
  const tag = el.localName + (el.id ? '#' + el.id : '');
  return text ? `${tag} "${text.length > 18 ? text.slice(0, 17) + '…' : text}"` : tag;
}
