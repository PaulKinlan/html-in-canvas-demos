// Redaction drawn by the canvas of a <selection-fx effect="redact">.
//
// A redacted range is kept as two offsets and as a Range in a CSS Custom
// Highlight that has no style. The element measures that Highlight's
// rectangles (its `highlight` attribute) and the effect draws over them.
// The canvas only changes pixels: the text is still in the DOM until
// removeText() replaces it.

import { defineSelectionEffect } from '/lib/selection-fx.js';
import { offsetsOf, rangeAt, copyText, roundPath, copyCanvas } from '/lib/selection-tools.js';

const scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHKMNPRSTUVWXYZ0123456789';

// #region effect
defineSelectionEffect('redact', {
  color: '#d2491f',
  draw(ctx, s, el) {
    // The reader's own selection, so they can see what "Redact" will take.
    // (s.rects also holds the redacted ranges, so it is only used while something is selected.)
    if (!getSelection().isCollapsed) {
      ctx.fillStyle = s.color.alpha(0.25);
      for (const r of s.rects) { roundPath(ctx, r, 1, 4); ctx.fill(); }
    }
    el.drawContent(ctx);
    const style = el.redactStyle ?? 'bar';
    const k = el.scale;
    for (const r of s.marked) {
      const box = { x: r.x - 1.5, y: r.y, w: r.w + 3, h: r.h };
      if (style === 'bar') {
        // #region bar
        ctx.fillStyle = s.fg.css;
        roundPath(ctx, box, 0, 2);
        ctx.fill();
        // #endregion bar
      } else if (style === 'pixels') {
        // #region pixels
        // Copy this part of the canvas into a few large cells and draw them back unsmoothed.
        const cell = 6;
        const w = Math.max(1, Math.round(box.w / cell)), h = Math.max(1, Math.round(box.h / cell));
        scratch.width = w;
        scratch.height = h;
        const t = scratch.getContext('2d');
        t.fillStyle = s.bg.css;
        t.fillRect(0, 0, w, h);
        t.imageSmoothingQuality = 'high';
        t.drawImage(ctx.canvas, (box.x + s.bleed) * k, (box.y + s.bleed) * k, box.w * k, box.h * k, 0, 0, w, h);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(box.x, box.y, box.w, box.h);
        ctx.drawImage(scratch, box.x, box.y, box.w, box.h);
        ctx.restore();
        // #endregion pixels
      } else if (style === 'blur') {
        // #region blur
        // Draw the element again through a blur filter, clipped to the rectangle.
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.w, box.h);
        ctx.clip();
        ctx.clearRect(box.x, box.y, box.w, box.h);
        ctx.filter = `blur(${6 * k}px)`; // filter lengths are canvas pixels
        el.drawContent(ctx);
        ctx.restore();
        // #endregion blur
      } else {
        // #region scramble
        // Other letters in the same font, changed eleven times a second.
        const tick = s.still ? 0 : Math.floor(s.time * 11);
        ctx.save();
        ctx.clearRect(box.x, box.y, box.w, box.h);
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.w, box.h);
        ctx.clip();
        ctx.font = el.redactFont ?? '16px serif';
        ctx.fillStyle = s.fg.css;
        ctx.textBaseline = 'middle';
        let seed = (tick * 7919 + Math.round(r.y) * 31 + Math.round(r.x)) >>> 0;
        for (let x = r.x; x < r.x + r.w;) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const ch = LETTERS[seed % LETTERS.length];
          ctx.fillText(ch, x, r.y + r.h / 2);
          x += ctx.measureText(ch).width;
        }
        ctx.restore();
        // #endregion scramble
      }
    }
    if (style === 'scramble' && s.marked.length && !s.still && !el.redactTimer) {
      el.redactTimer = setTimeout(() => { el.redactTimer = 0; el.invalidate(); }, 90);
    }
  },
});
// #endregion effect

let count = 0;

/** Give a <selection-fx effect="redact"> its list of redacted ranges. */
export function attach(el, article, { onchange = () => {} } = {}) {
  const name = `redacted-${++count}`;
  const highlight = new Highlight();
  CSS.highlights.set(name, highlight);
  el.setAttribute('highlight', name);
  el.redactFont = getComputedStyle(article).font;
  let items = []; // { start, end }

  // #region ranges
  function rebuild() {
    highlight.clear();
    for (const it of items) highlight.add(rangeAt(article, it.start, it.end));
    el.refresh(); // a Highlight with no ::highlight() style causes no repaint
    el.invalidate();
    onchange(items);
  }
  function add(range) {
    const o = offsetsOf(article, range);
    if (!o || o.end <= o.start) return false;
    items.push(o);
    rebuild();
    return true;
  }
  function addMatches(pattern) {
    const text = article.textContent;
    let n = 0;
    for (const m of text.matchAll(pattern)) { items.push({ start: m.index, end: m.index + m[0].length }); n++; }
    rebuild();
    return n;
  }
  // #endregion ranges

  // #region remove
  /** Replace every redacted character in the DOM with a block character. */
  function removeText() {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let at = 0, n = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.data;
      let out = '';
      for (let i = 0; i < data.length; i++) {
        const hide = !/\s/.test(data[i]) && items.some((it) => at + i >= it.start && at + i < it.end);
        out += hide ? '█' : data[i];
        if (hide && data[i] !== '█') n++;
      }
      if (out !== data) node.data = out;
      at += data.length;
    }
    rebuild(); // the offsets are unchanged, the ranges are made again
    return n;
  }
  // #endregion remove

  // #region copy
  // Copy gives blocks for redacted characters when el.redactCopy is true.
  article.addEventListener('copy', (e) => {
    if (!el.redactCopy || !items.length) return;
    const selection = getSelection();
    const o = selection.rangeCount ? offsetsOf(article, selection.getRangeAt(0)) : null;
    if (!o) return;
    e.clipboardData.setData('text/plain', copyText(article, o.start, o.end, items));
    e.preventDefault();
  });
  // #endregion copy

  return {
    name,
    get items() { return items; },
    add, addMatches, removeText,
    style(s) { el.redactStyle = s; el.invalidate(); },
    clear() { items = []; rebuild(); },
    dispose() { CSS.highlights.delete(name); },
    /** The canvas on the page's background colour, as a PNG blob. */
    async png(background) {
      const top = copyCanvas(el);
      const out = new OffscreenCanvas(top.width, top.height);
      const c = out.getContext('2d');
      c.fillStyle = background;
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(top, 0, 0);
      return out.convertToBlob({ type: 'image/png' });
    },
  };
}
