// A heat map of selections and a minimap, for a <selection-fx effect="heat">.
//
// Every recorded selection adds one to a counter per character. The canvas
// colours the text by those counters and draws the whole article a second
// time, small, in a column at the right with the same colours.

import { defineSelectionEffect } from '/lib/selection-fx.js';
import { rangeAt, localRects, roundPath } from '/lib/selection-tools.js';

export const RAMP = ['rgb(255, 236, 170)', 'rgb(255, 208, 110)', 'rgb(255, 170, 80)', 'rgb(255, 122, 62)', 'rgb(232, 67, 46)'];
export const MAP_WIDTH = 54;

// #region effect
defineSelectionEffect('heat', {
  color: '#1d1b16',
  draw(ctx, s, el) {
    const h = el.heat;
    if (!h) return el.drawContent(ctx);
    if (h.dirty || h.width !== s.width) h.measure(s.width);

    // Heat behind the text.
    for (const run of h.runs) {
      ctx.fillStyle = RAMP[run.level - 1];
      for (const r of run.rects) ctx.fillRect(r.x, r.y + 1, r.w + 0.5, r.h - 2);
    }
    // The reader's own selection: an outline, so the heat under it stays visible.
    ctx.strokeStyle = s.color.alpha(0.85);
    ctx.lineWidth = 1.5;
    for (const r of s.rects) { roundPath(ctx, r, 1.5, 4); ctx.stroke(); }
    el.drawContent(ctx);

    // #region minimap
    // The same element drawn again at about a tenth of its size. It stays in
    // view while the page scrolls: `top` is where the window's top edge is,
    // in the element's own pixels.
    const k = MAP_WIDTH / s.width;
    const mapH = s.height * k;
    const x = s.width - MAP_WIDTH - 1;
    const y = Math.max(0, Math.min(s.height - mapH, h.top + 64)); // 64: below the site menu, which stays at the top of the window
    h.map = { x, y, w: MAP_WIDTH, h: mapH, k };
    ctx.fillStyle = 'rgb(255 255 255 / 0.94)';
    ctx.strokeStyle = 'rgb(0 0 0 / 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, MAP_WIDTH + 6, mapH + 6, 4);
    ctx.fill();
    ctx.stroke();
    for (const run of h.runs) {
      ctx.fillStyle = RAMP[run.level - 1];
      for (const r of run.rects) ctx.fillRect(x + r.x * k, y + r.y * k, Math.max(1, r.w * k), Math.max(1.5, r.h * k));
    }
    ctx.drawElementImage(el.content, x, y, MAP_WIDTH, mapH);
    // The part of the article that is on screen.
    const from = Math.max(0, h.top), to = Math.min(s.height, h.top + h.view);
    if (to > from) {
      ctx.strokeStyle = '#2f6fed';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 1.5, y + from * k, MAP_WIDTH + 3, (to - from) * k);
    }
    // #endregion minimap
  },
});
// #endregion effect

/** Sentences of a text as { start, end } offsets. */
export function sentences(text) {
  return [...text.matchAll(/[^.!?\s][^.!?]*[.!?]/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** Give a <selection-fx effect="heat"> its counters. */
export function attach(el, article, { onchange = () => {} } = {}) {
  const length = article.textContent.length;
  const h = (el.heat = {
    counts: new Uint16Array(length),
    total: 0,
    runs: [],
    dirty: true,
    width: 0,
    top: 0,
    view: 0,
    map: null,
    // #region runs
    // Turn the counters into runs of characters with the same level (1 to 5)
    // and measure the rectangles of each run.
    measure(width) {
      this.width = width;
      this.dirty = false;
      this.runs = [];
      const max = this.counts.reduce((a, b) => Math.max(a, b), 0);
      if (!max) return;
      const level = (i) => Math.ceil((this.counts[i] / max) * RAMP.length);
      for (let i = 0; i < length;) {
        const l = level(i);
        let j = i + 1;
        while (j < length && level(j) === l) j++;
        if (l) this.runs.push({ start: i, end: j, level: l, rects: localRects(el, rangeAt(article, i, j)) });
        i = j;
      }
    },
    // #endregion runs
  });

  // #region record
  function add(start, end, times = 1) {
    start = Math.max(0, start);
    end = Math.min(length, end);
    if (end <= start) return;
    for (let i = start; i < end; i++) h.counts[i] = Math.min(65535, h.counts[i] + times);
    h.total += times;
    h.dirty = true;
    el.invalidate();
    onchange(h);
  }
  // #endregion record

  /** Selections of n made-up readers. The same seed gives the same readers. */
  function simulate(n, seed = 7) {
    const list = sentences(article.textContent);
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const liked = list.map(() => random() ** 3); // a few sentences are picked far more often
    for (let reader = 0; reader < n; reader++) {
      for (let pick = 0; pick < 2; pick++) {
        let best = 0, score = -1;
        for (let i = 0; i < list.length; i++) { const v = liked[i] * random(); if (v > score) { score = v; best = i; } }
        const sn = list[best];
        // Half of the readers take the whole sentence, the rest a part of it.
        const part = random() < 0.5 ? 1 : 0.35 + random() * 0.5;
        const size = Math.round((sn.end - sn.start) * part);
        const from = sn.start + Math.round((sn.end - sn.start - size) * random());
        add(from, from + size);
      }
    }
  }

  // Where the window's top edge is in the element's pixels, for the minimap.
  function place() {
    const r = el.getBoundingClientRect();
    const top = Math.round(-r.top), view = innerHeight;
    if (top === h.top && view === h.view) return;
    h.top = top;
    h.view = view;
    el.invalidate();
  }
  place();
  addEventListener('scroll', place, { passive: true });
  addEventListener('resize', place);

  return {
    state: h,
    add, simulate, place,
    clear() { h.counts.fill(0); h.total = 0; h.dirty = true; el.invalidate(); onchange(h); },
    /** The most selected run of text: { start, end, count }. */
    top() {
      let best = null;
      const max = h.counts.reduce((a, b) => Math.max(a, b), 0);
      if (!max) return null;
      for (let i = 0; i < length; i++) {
        if (h.counts[i] !== max) continue;
        let j = i;
        while (j < length && h.counts[j] === max) j++;
        if (!best || j - i > best.end - best.start) best = { start: i, end: j, count: max };
        i = j;
      }
      return best;
    },
    dispose() { removeEventListener('scroll', place); removeEventListener('resize', place); },
  };
}
