// Layout debugger overlay: the margin, border, padding and content box of every
// element under a drawn root, and the baseline of every line of text, drawn
// over the picture in the same canvas.
import { cssScale, plate } from './stage.js';

// #region identity
/**
 * Read layout positions of a drawn element's descendants.
 *
 * Client rectangles of a canvas child follow the last draw. After a turned or
 * scaled draw they are bounding boxes in the canvas, and no call returns the
 * layout rectangle of a line of text. So draw the root once at 0, 0 with no
 * transform and no ink (globalAlpha 0 still places the element), read every
 * rectangle while it is there, and let the caller draw it for real afterwards.
 * The last draw decides where the element is hit tested.
 */
export function atIdentity(ctx, root, read) {
  const k = cssScale(ctx.canvas);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalAlpha = 0;
  ctx.drawElementImage(root, 0, 0, root.offsetWidth, root.offsetHeight);
  ctx.restore();
  const origin = root.getBoundingClientRect(); // now the canvas origin, in client px
  return read(origin);
}
// #endregion identity

// #region measure
const px = (v) => parseFloat(v) || 0;
const sides = (style, name, suffix = '') => ({
  top: px(style[`${name}Top${suffix}`]), right: px(style[`${name}Right${suffix}`]),
  bottom: px(style[`${name}Bottom${suffix}`]), left: px(style[`${name}Left${suffix}`]),
});

/** One entry per rendered element under `root` (and the root), in the root's layout px. Call inside atIdentity(). */
export function measureBoxes(root, origin) {
  const out = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const style = getComputedStyle(el);
    let depth = 0;
    for (let p = el; p !== root; p = p.parentElement) depth++;
    out.push({
      el, depth, display: style.display,
      x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height,
      margin: sides(style, 'margin'), border: sides(style, 'border', 'Width'), padding: sides(style, 'padding'),
    });
  }
  return out;
}

const ruler = document.createElement('canvas').getContext('2d');
const ascents = new Map();
/** The distance from the top of an inline box to its baseline: the ascent of the element's font. */
function ascentOf(style) {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if (!ascents.has(font)) { ruler.font = font; ascents.set(font, ruler.measureText('x').fontBoundingBoxAscent); }
  return ascents.get(font);
}

/**
 * One entry per line fragment of text: { x, y, width } where y is the baseline.
 * A Range over a text node gives one rectangle per line. The rectangle is the
 * inline box, whose height is the font's ascent plus descent, so the baseline
 * is its top plus the ascent.
 */
export function measureBaselines(root, origin) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim() || !node.parentElement.checkVisibility()) continue;
    const ascent = ascentOf(getComputedStyle(node.parentElement));
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      out.push({ x: r.left - origin.left, y: r.top - origin.top + ascent, width: r.width, el: node.parentElement });
    }
  }
  return out;
}
// #endregion measure

// #region draw-boxes
export const BOX_INK = { margin: 'rgba(246,160,60,.55)', border: 'rgba(250,210,80,.7)', padding: 'rgba(120,200,110,.55)', content: 'rgba(70,140,255,.9)', baseline: '#e5177b' };

const grow = (b, s, sign = 1) => ({ x: b.x - s.left * sign, y: b.y - s.top * sign, width: b.width + (s.left + s.right) * sign, height: b.height + (s.top + s.bottom) * sign });
function ring(ctx, outer, inner, fill) {
  if (outer.width <= inner.width && outer.height <= inner.height) return;
  ctx.beginPath();
  ctx.rect(outer.x, outer.y, outer.width, outer.height);
  ctx.rect(inner.x, inner.y, inner.width, inner.height);
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
}

/**
 * Draw the boxes. The context must already carry the transform the root was
 * drawn with, so the overlay lies on the picture whatever that transform is.
 */
export function drawBoxes(ctx, boxes, baselines, { margin = true, padding = true, content = false, baseline = true, selected = null } = {}) {
  ctx.save();
  for (const b of boxes) {
    if (selected && b.el !== selected) continue;
    const inline = b.display === 'inline';
    const borderBox = b, paddingBox = grow(borderBox, b.border, -1), contentBox = grow(paddingBox, b.padding, -1);
    // Vertical margins do not apply to an inline box.
    const m = inline ? { ...b.margin, top: 0, bottom: 0 } : b.margin;
    if (margin || selected) ring(ctx, grow(borderBox, { top: Math.max(0, m.top), right: Math.max(0, m.right), bottom: Math.max(0, m.bottom), left: Math.max(0, m.left) }), borderBox, BOX_INK.margin);
    if (selected) ring(ctx, borderBox, paddingBox, BOX_INK.border);
    if (padding || selected) ring(ctx, paddingBox, contentBox, BOX_INK.padding);
    if (content || selected) {
      ctx.strokeStyle = BOX_INK.content;
      ctx.lineWidth = selected ? 1.5 : 0.75;
      ctx.strokeRect(contentBox.x + 0.5, contentBox.y + 0.5, Math.max(0, contentBox.width - 1), Math.max(0, contentBox.height - 1));
      if (selected) { ctx.fillStyle = 'rgba(70,140,255,.22)'; ctx.fillRect(contentBox.x, contentBox.y, contentBox.width, contentBox.height); }
    }
  }
  if (baseline) {
    ctx.strokeStyle = BOX_INK.baseline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const l of baselines) {
      if (selected && !selected.contains(l.el)) continue;
      const y = Math.round(l.y) + 0.5;
      ctx.moveTo(l.x, y);
      ctx.lineTo(l.x + l.width, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const four = (s) => {
  const v = [s.top, s.right, s.bottom, s.left].map((n) => +n.toFixed(1));
  if (v.every((n) => n === v[0])) return String(v[0]);
  return v[0] === v[2] && v[1] === v[3] ? `${v[0]} ${v[1]}` : v.join(' ');
};
/** "p  300 × 44  margin 8 0  padding 0", as a browser's inspector labels a box. */
export function describeBox(b) {
  const tag = b.el.localName + (b.el.id ? '#' + b.el.id : '') + (b.el.classList[0] ? '.' + b.el.classList[0] : '');
  return { tag, size: `${+b.width.toFixed(1)} × ${+b.height.toFixed(1)}`, margin: four(b.margin), border: four(b.border), padding: four(b.padding), display: b.display };
}

/** A label for the selected box, drawn in canvas CSS px (no transform). `at` is a point on the canvas. */
export function drawBoxLabel(ctx, b, at, width) {
  const d = describeBox(b);
  const text = `${d.tag}  ${d.size}  margin ${d.margin}  padding ${d.padding}`;
  plate(ctx, text, Math.max(4, at.x), Math.max(4, at.y - 22), { maxX: width - 4, stroke: '#fff' });
}
// #endregion draw-boxes
