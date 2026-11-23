// liquid-field.js: make the shapes drawn in a 2D canvas join and split like drops, and keep what is inside them sharp.
// Used by /liquid-shapes/.
//
// The usual way is a CSS blur followed by a hard contrast on a wrapper. It joins flat shapes and it ruins any
// text inside them. Here the canvas does the same two steps to a copy of itself and then draws the elements
// again, sharp, inside the outline that comes back.
//
//   const field = liquidField({ blur: 8 });
//   canvas.addEventListener('paint', () => {
//     field.draw(ctx, cssWidth, cssHeight, 'liquid',
//       () => { ...draw every shape and element that should join... },
//       () => { ...draw the elements again... });
//   });
//
// Modes: 'liquid' (field, then the elements inside it), 'field' (the field alone, which is what a filter
// on a wrapper gives) and 'plain' (no field).
//
// The copy is a drawImage() of the canvas into a plain canvas that is never read, so nothing is read back.

const NS = 'http://www.w3.org/2000/svg';
const FILTER = 'liquid-field-cut';

// #region cut
// An alpha threshold as an SVG filter: alpha' = 24 * alpha - 11.5. Alpha under 0.48 becomes 0 and alpha over
// 0.52 becomes 1. ctx.filter accepts it as url(#id).
function cutFilter() {
  if (document.getElementById(FILTER)) return;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  const filter = document.createElementNS(NS, 'filter');
  filter.id = FILTER;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const m = document.createElementNS(NS, 'feColorMatrix');
  m.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11.5');
  filter.append(m); svg.append(filter); document.body.append(svg);
}
// #endregion cut

// #region field
export function liquidField({ blur = 8 } = {}) {
  cutFilter();
  // The blurred copy is kept at one pixel per CSS pixel. A blur has no detail to lose, and on a phone at
  // scale 2.625 this is a seventh of the pixels.
  const copy = document.createElement('canvas');
  const cx = copy.getContext('2d');
  const field = { blur, draw };

  function draw(ctx, w, h, mode, join, sharp) {
    join(ctx);                                   // 1. everything that should join, drawn plainly
    if (mode === 'plain') { sharp(ctx); return; }
    if (mode === 'field') sharp(ctx);            // the CSS way: labels and icons go through the filter too
    const cv = ctx.canvas, cw = Math.max(1, Math.ceil(w)), ch = Math.max(1, Math.ceil(h));
    if (copy.width !== cw) copy.width = cw;
    if (copy.height !== ch) copy.height = ch;
    cx.reset();
    cx.filter = `blur(${field.blur}px)`;         // 2. a blurred copy of the canvas as it is now
    cx.drawImage(cv, 0, 0, cw, ch);
    ctx.save();
    ctx.resetTransform();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.filter = `url(#${FILTER})`;              // 3. the copy back through the threshold: the joined outline
    ctx.drawImage(copy, 0, 0, cv.width, cv.height);
    ctx.restore();
    if (mode === 'field') return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop'; // 4. the elements again, kept inside the outline
    sharp(ctx);
    ctx.restore();
  }
  return field;
}
// #endregion field

// A spring for a value that should overshoot and settle: s = { x, v }. Returns true while it is moving.
export function spring(s, target, dt, stiffness = 120, damping = 11) {
  for (let i = 0; i < 2; i++) {
    const a = -stiffness * (s.x - target) - damping * s.v;
    s.v += a * dt / 2;
    s.x += s.v * dt / 2;
  }
  if (Math.abs(s.x - target) < 0.002 && Math.abs(s.v) < 0.02) { s.x = target; s.v = 0; return false; }
  return true;
}
