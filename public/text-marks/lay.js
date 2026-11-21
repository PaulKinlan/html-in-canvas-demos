import { put } from '/form-state/kit.js';

// #region lay
// Centre a sheet (a drawable block of text) in the canvas, scaled down if the canvas is narrower, and
// run draw() in the sheet's own layout pixels. Returns how to turn a client rectangle into those pixels.
export function lay(ctx, canvas, sheet, w, h, draw) {
  const W = sheet.offsetWidth, H = sheet.offsetHeight, k = Math.min(1, (w - 16) / W);
  const x = (w - W * k) / 2, y = Math.max(8, (h - H * k) / 2);
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k);
  const c = canvas.getBoundingClientRect();
  // Client rectangles of text inside a drawn element are reported at the place it was drawn.
  const local = (r) => ({ x: (r.x - c.x - x) / k, y: (r.y - c.y - y) / k, w: r.width / k, h: r.height / k });
  draw({ W, H, k, x, y, local });
  ctx.restore();
}
// One piece of the sheet: the box (bx, by, bw, bh) of its layout, drawn moved by (dx, dy).
export function piece(ctx, sheet, bx, by, bw, bh, dx = 0, dy = 0) {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  put(ctx, sheet, 0, 0);
  ctx.restore();
}
// #endregion lay
