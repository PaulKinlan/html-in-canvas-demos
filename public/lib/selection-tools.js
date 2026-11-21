// Helpers for pages that draw things from text ranges inside a <selection-fx>
// element: ranges as character offsets (to store or send them), and the
// rectangles of a range in the element's own CSS pixels.
//
//   offsetsOf(root, range)        -> { start, end } counted in root.textContent
//   rangeAt(root, start, end)     -> Range
//   localRects(el, range)         -> one rectangle per line, in el's CSS px
//   glyphRects(el, range, max)    -> one rectangle per character that has ink
//   copyText(root, start, end, hidden) -> the text with hidden offsets replaced
//
// `el` is a <selection-fx> (or any SurfaceElement) that draws its content at
// its layout position, which <selection-fx> always does.

import { textRects, mergeLines } from './selection-fx.js';
import { cssZoom } from './surface.js';

// #region offsets
/** Where a range starts and ends, as character offsets into root.textContent. */
export function offsetsOf(root, range) {
  if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = new Range();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

/** The range that covers characters start..end of root.textContent. */
export function rangeAt(root, start, end) {
  const range = new Range();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let at = 0;
  let began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = at + node.length;
    if (!began && start < next) {
      range.setStart(node, Math.max(0, start - at));
      began = true;
    }
    if (began && end <= next) {
      range.setEnd(node, Math.max(0, end - at));
      return range;
    }
    at = next;
  }
  if (!began) range.selectNodeContents(root), range.collapse(false);
  else range.setEnd(root, root.childNodes.length);
  return range;
}
// #endregion offsets

// #region local
/** Rectangles of a range in the element's CSS px, one per line unless merge is false. */
export function localRects(el, range, { merge = true } = {}) {
  const base = el.getBoundingClientRect();
  const zoom = cssZoom(el);
  const rects = textRects(range, el).map((q) => ({ x: (q.left - base.left) / zoom, y: (q.top - base.top) / zoom, w: q.width / zoom, h: q.height / zoom }));
  return merge ? mergeLines(rects) : rects;
}
// #endregion local

// #region glyphs
/** One rectangle per character of the range that is not white space, with the character. */
export function glyphRects(el, range, max = 800) {
  const out = [];
  if (!range || range.collapsed) return out;
  const base = el.getBoundingClientRect();
  const zoom = cssZoom(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const one = new Range();
  for (let node = walker.nextNode(); node && out.length < max; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    for (let i = from; i < to && out.length < max; i++) {
      if (/\s/.test(node.data[i])) continue;
      one.setStart(node, i);
      one.setEnd(node, i + 1);
      const q = one.getClientRects()[0];
      if (!q || q.width < 0.5) continue;
      out.push({ x: (q.left - base.left) / zoom, y: (q.top - base.top) / zoom, w: q.width / zoom, h: q.height / zoom, ch: node.data[i] });
    }
  }
  return out;
}
// #endregion glyphs

// #region copy
/**
 * The text of characters start..end with a blank line between blocks. Every
 * character whose offset is inside one of `hidden` ([{start, end}]) is
 * replaced by a block character.
 */
export function copyText(root, start, end, hidden = []) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const block = (node) => node.parentElement.closest('p, li, h1, h2, h3, h4, blockquote, pre, div');
  let at = 0;
  let out = '';
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + node.length);
    if (to > from) {
      const b = block(node);
      if (last && b !== last) out += '\n\n';
      last = b;
      for (let i = from; i < to; i++) {
        const ch = node.data[i - at];
        out += !/\s/.test(ch) && hidden.some((h) => i >= h.start && i < h.end) ? '█' : ch;
      }
    }
    at += node.length;
  }
  return out;
}
// #endregion copy

/** A rounded rectangle path, grown by pad on every side. */
export function roundPath(ctx, r, pad = 0, radius = 4) {
  ctx.beginPath();
  ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, radius);
}

/** Wait until a <selection-fx> has drawn its first frame. */
export async function whenReady(el, ms = 3000) {
  for (let t = 0; t < ms && !el.ready; t += 50) await new Promise((r) => setTimeout(r, 50));
  if (!el.ready) throw new Error(`the element did not start (${el.note || el.getAttribute('plain') || 'no paint yet'})`);
  return el;
}

/** Count pixels of an ImageData for which test(r, g, b, a, x, y) is true. */
export function countPixels(image, test) {
  const d = image.data;
  let n = 0;
  for (let y = 0, i = 0; y < image.height; y++) for (let x = 0; x < image.width; x++, i += 4) if (test(d[i], d[i + 1], d[i + 2], d[i + 3], x, y)) n++;
  return n;
}
