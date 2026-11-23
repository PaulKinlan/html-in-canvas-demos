// genie.js: draw an element as horizontal strips that bend into a funnel and pour into a target.
// The macOS "genie" effect, for a 2D canvas that draws its own HTML children. Used by /genie/.
//
//   genie(ctx, el, x, y, target, p, { step, route, gaps, image, scale });
//
// x, y      where the element is when it is whole (CSS pixels, after ctx.scale(dpr, dpr))
// target    { x, y, w }: the centre, the top and the width of the place it pours into
// p         0 is whole, 1 is all in the target
// step      height of a strip in the element, in CSS pixels (default 2)
// route     'source' draws each strip with the nine-argument drawElementImage() (a source rectangle).
//           'clip' draws the whole element once for each strip, clipped to it.
//           'bitmap' doesn't draw the element at all. It copies strips with drawImage() from `image`, a plain
//           canvas that holds one picture of the element at `scale` device pixels for each CSS pixel.
// gaps      true leaves space between strips, to show them
// Returns the number of strips drawn.
//
// The source and clip routes leave the element's hit box somewhere other than its layout place. While it moves, take it
// out of hit testing (park() in stage-2d.js). When it is whole again, draw it whole: that restores the box.

const clamp = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// #region shape
// Where the row at `v` (0 at the top of the element, 1 at the bottom) is drawn at progress p.
// First the sides bend in towards the target, then the rows slide down the funnel they make.
export function genieShape(x, y, W, H, target, p) {
  const bend = smooth(p / 0.45), slide = smooth((p - 0.2) / 0.8);
  const top = lerp(y, target.y, slide), bottom = lerp(y + H, target.y, bend);
  return (v) => {
    const rowY = lerp(top, bottom, v);
    const down = smooth((rowY - y) / (target.y - y)) * bend;           // 0 at the element's top, 1 at the target
    const left = lerp(x, target.x - target.w / 2, down), right = lerp(x + W, target.x + target.w / 2, down);
    return { y: rowY, left, width: right - left };
  };
}
// #endregion shape

// #region strips
export function genie(ctx, el, x, y, target, p, { step = 2, route = 'source', gaps = false, image = null, scale = 1 } = {}) {
  const W = el.offsetWidth, H = el.offsetHeight, row = genieShape(x, y, W, H, target, p);
  let drawn = 0;
  for (let sy = 0; sy < H; sy += step) {
    const sh = Math.min(step, H - sy), a = row(sy / H), b = row((sy + sh) / H), m = row((sy + sh / 2) / H);
    const dh = (b.y - a.y) * (gaps ? 0.6 : 1);
    if (dh < 0.02 || m.width < 0.5) continue;
    if (route === 'bitmap') {
      // Pixels that were drawn once. A strip is a copy of part of a texture, with nothing to rasterise.
      ctx.drawImage(image, 0, sy * scale, W * scale, sh * scale, m.left, a.y, m.width, dh + (gaps ? 0 : 0.5));
    } else if (route === 'source') {
      // Nine arguments: a piece of the element (sx, sy, sw, sh), then where to put it and how large.
      ctx.drawElementImage(el, 0, sy, W, sh, m.left, a.y, m.width, dh + (gaps ? 0 : 0.5));
    } else {
      ctx.save();
      ctx.translate(m.left, a.y);
      ctx.scale(m.width / W, dh / sh);
      ctx.beginPath();
      ctx.rect(0, 0, W, sh + (gaps ? 0 : 0.5 * sh / dh));              // half a pixel of overlap hides the seams
      ctx.clip();
      ctx.drawElementImage(el, 0, -sy, W, H);
      ctx.restore();
    }
    drawn++;
  }
  return drawn;
}
// #endregion strips
