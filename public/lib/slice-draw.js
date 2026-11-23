// slice-draw.js: draw an element as vertical strips, each with its own place, scale and shear.
// A 2D context can't bend a picture. It can draw the picture many times, each time clipped to one strip
// under its own transform, and enough strips read as a bend, a wave or a lens. Used by /elastic-range/.
//
//   drawSlices(ctx, el, x, y, step, (u, width) => ({ x, y, sx, sy, shear, w }));
//
// `u` is the strip's left edge inside the element, in CSS pixels. The callback says where the strip goes:
//   x, y    where its left edge and its vertical centre go, relative to the element's own place (default u, 0)
//   sx, sy  scale along and across (default 1)
//   shear   rise per pixel along the strip, so that neighbouring strips meet (default 0)
//   w       how much of the strip to show, for gaps between strips (default: all of it)
// Return null to leave a strip out.
//
// Every strip is a draw of the whole element, and the last draw of an element is where its hit box is.
// Finish with one draw at the place input should go (hitOnly() in stage-2d.js does it with no ink).

// #region slices
export function drawSlices(ctx, el, x, y, step, place) {
  const w = el.offsetWidth, h = el.offsetHeight;
  for (let u = 0; u < w; u += step) {
    const width = Math.min(step, w - u), p = place(u, width);
    if (!p) continue;
    ctx.save();
    ctx.translate(x + (p.x ?? u), y + h / 2 + (p.y ?? 0));        // the strip's left edge, at the element's centre line
    ctx.transform(p.sx ?? 1, p.shear ?? 0, 0, p.sy ?? 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, -h, p.w ?? width + 0.6, h * 2);                   // 0.6 px of overlap hides the seams
    ctx.clip();
    ctx.drawElementImage(el, -u, -h / 2, w, h);
    ctx.restore();
  }
}
// #endregion slices

export const gauss = (d, sigma) => Math.exp(-(d * d) / (2 * sigma * sigma));
