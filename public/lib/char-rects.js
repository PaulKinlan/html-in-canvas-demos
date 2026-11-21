// One rectangle per character of the text in an <input> or <textarea>.
//
//   import { charRects } from '/lib/char-rects.js';
//   const { rects, method } = charRects(input);
//   // rects[i] = { x, y, width, height, char }, in CSS px from the input's top-left corner
//
// The text of a form control is not in the DOM, so a Range cannot measure it.
// Two methods:
//
//   'OpaqueRange'   input.createValueRange(i, i + 1).getBoundingClientRect().
//                   The browser's own layout: any font, letter-spacing, scrolling
//                   and (in a textarea) line wrapping are accounted for.
//   'measureText'   where that method is missing: a 2D context measures the
//                   text before each character in the input's font. One line
//                   only, start-aligned, no letter-spacing.
//
// Both subtract the input's own getBoundingClientRect(), so the result is the
// same whether the browser reports the layout box or the place the input was
// drawn in a canvas.

let measurer = null;

export function hasValueRange(input) {
  return typeof input.createValueRange === 'function';
}

export function charRects(input, { method = hasValueRange(input) ? 'OpaqueRange' : 'measureText' } = {}) {
  const value = input.value;
  const box = input.getBoundingClientRect();
  const rects = [];
  // #region opaque
  if (method === 'OpaqueRange') {
    for (let i = 0; i < value.length; i++) {
      const r = input.createValueRange(i, i + 1).getBoundingClientRect();
      rects.push({ x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height, char: value[i] });
    }
    return { rects, method };
  }
  // #endregion opaque
  // #region measure
  const cs = getComputedStyle(input);
  measurer ??= document.createElement('canvas').getContext('2d');
  measurer.font = cs.font;
  const left = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - input.scrollLeft;
  const top = parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const inner = input.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const m = measurer.measureText('Mg');
  const height = Math.min(inner, (m.fontBoundingBoxAscent ?? 0) + (m.fontBoundingBoxDescent ?? 0) || parseFloat(cs.fontSize) * 1.2);
  let before = 0;
  for (let i = 0; i < value.length; i++) {
    const after = measurer.measureText(value.slice(0, i + 1)).width;
    rects.push({ x: left + before, y: top + (inner - height) / 2, width: after - before, height, char: value[i] });
    before = after;
  }
  return { rects, method: 'measureText' };
  // #endregion measure
}
