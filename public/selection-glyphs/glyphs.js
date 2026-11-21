// Selected letters as particles, for a <selection-fx effect="glyphs">.
//
// The text stays in the DOM. The canvas leaves a hole where each selected
// letter was and draws the letter somewhere else. A letter is either a piece
// of a snapshot of the canvas, or the element drawn again through a clip.

import { defineSelectionEffect } from '/lib/selection-fx.js';
import { glyphRects, roundPath } from '/lib/selection-tools.js';

const GRAVITY = 1500;
const still = matchMedia('(prefers-reduced-motion: reduce)');

// #region effect
defineSelectionEffect('glyphs', {
  color: '#d2491f',
  draw(ctx, s, el) {
    const g = el.glyphs;
    if (!g || el.capturing) return el.drawContent(ctx); // the snapshot is the text alone
    // The selection, as an outline of where the letters came from.
    ctx.fillStyle = s.color.alpha(g.items.length ? 0.1 : 0.22);
    for (const r of s.rects) { roundPath(ctx, r, 1, 4); ctx.fill(); }

    // #region hole
    // Draw the element everywhere except the home rectangle of each loose letter.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-s.bleed, -s.bleed, s.width + 2 * s.bleed, s.height + 2 * s.bleed);
    for (const p of g.items) ctx.rect(p.home.x, p.home.y, p.home.w, p.home.h);
    ctx.clip('evenodd');
    el.drawContent(ctx);
    ctx.restore();
    // #endregion hole

    const dt = Math.min(0.033, Math.max(0, s.time - g.last)) || 0.016;
    g.last = s.time;
    if (!s.still) g.step(dt, s);
    else for (const p of g.items) { p.x = p.home.x; p.y = g.mode === 'home' ? p.home.y : s.height - p.home.h - 4; p.rot = 0; }

    // #region letter
    const k = el.scale;
    for (const p of g.items) {
      ctx.save();
      ctx.translate(p.x + p.home.w / 2, p.y + p.home.h / 2);
      ctx.rotate(p.rot);
      ctx.translate(-p.home.w / 2, -p.home.h / 2);
      if (g.source === 'live') {
        // The element again, clipped to one letter and moved so that letter lands here.
        ctx.beginPath();
        ctx.rect(0, 0, p.home.w, p.home.h);
        ctx.clip();
        ctx.drawElementImage(el.content, -p.home.x, -p.home.y, s.width, s.height);
      } else {
        // A piece of the picture taken when the letters were let go.
        ctx.drawImage(g.sprite, (p.home.x + s.bleed) * k, (p.home.y + s.bleed) * k, p.home.w * k, p.home.h * k, 0, 0, p.home.w, p.home.h);
      }
      ctx.restore();
    }
    // #endregion letter
    if (g.items.length && !s.still && !g.asleep) el.invalidate();
  },
});
// #endregion effect

/** Give a <selection-fx effect="glyphs"> its particle state. Returns the controller. */
export function attach(el, { onchange = () => {} } = {}) {
  const g = (el.glyphs = {
    items: [],
    sprite: null,
    source: 'snapshot',
    mode: 'fall',
    last: 0,
    asleep: false,
    // #region physics
    step(dt, s) {
      const floor = s.height - 4;
      let moving = 0;
      if (this.mode === 'fall') {
        const heap = new Float32Array(Math.ceil(s.width / 7) + 2); // how high the pile is in each column
        for (const p of this.items) if (p.rest) heap[Math.round((p.x + p.home.w / 2) / 7)] += p.home.h * 0.42;
        for (const p of this.items) {
          if (p.rest) continue;
          moving++;
          p.vy += GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * 0.6; }
          if (p.x > s.width - p.home.w) { p.x = s.width - p.home.w; p.vx = -Math.abs(p.vx) * 0.6; }
          const column = Math.round((p.x + p.home.w / 2) / 7);
          const ground = floor - p.home.h - Math.min(heap[column], 70);
          if (p.y >= ground && p.vy > 0) {
            p.y = ground;
            if (p.vy < 260) { p.rest = true; heap[column] += p.home.h * 0.42; p.rot = Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2) + (p.seed - 0.5) * 0.5; }
            else { p.vy *= -0.32; p.vx *= 0.7; p.vr *= 0.6; }
          }
        }
      } else if (this.mode === 'swirl') {
        const cx = s.width / 2, cy = s.height / 2;
        this.items.forEach((p, i) => {
          moving++;
          const ring = 0.25 + 0.75 * ((i * 0.618) % 1);
          const a = s.time * (0.5 + 1.2 * (1 - ring)) + i * 2.399;
          const tx = cx + Math.cos(a) * ring * Math.min(cx - 12, 260) - p.home.w / 2;
          const ty = cy + Math.sin(a) * ring * Math.min(cy - 12, 200) - p.home.h / 2;
          p.x += (tx - p.x) * Math.min(1, dt * 5);
          p.y += (ty - p.y) * Math.min(1, dt * 5);
          p.rot = a + Math.PI / 2;
          p.rest = false;
        });
      } else {
        // 'home': a spring back to where the letter belongs.
        for (const p of this.items) {
          const k = Math.min(1, dt * 9);
          p.x += (p.home.x - p.x) * k;
          p.y += (p.home.y - p.y) * k;
          p.rot += (Math.round(p.rot / (2 * Math.PI)) * 2 * Math.PI - p.rot) * k;
          if (Math.abs(p.home.x - p.x) + Math.abs(p.home.y - p.y) > 0.4) moving++;
        }
        if (!moving) { this.items = []; onchange(this); }
      }
      this.asleep = moving === 0;
    },
    // #endregion physics
  });

  // #region drop
  /** Let go of every letter in the range. */
  async function drop(range) {
    const rects = glyphRects(el, range, 900);
    if (!rects.length) return 0;
    // A snapshot of the text with nothing else in it. The canvas is transparent
    // where the element has no ink, so the pieces are letters without a backing.
    el.capturing = true;
    try {
      const image = await el.readback();
      const sprite = new OffscreenCanvas(image.width, image.height);
      sprite.getContext('2d').putImageData(image, 0, 0);
      g.sprite = sprite;
    } finally { el.capturing = false; }
    const have = new Set(g.items.map((p) => `${p.home.x.toFixed(1)},${p.home.y.toFixed(1)}`));
    const cx = rects.reduce((a, r) => a + r.x, 0) / rects.length;
    for (const home of rects) {
      if (have.has(`${home.x.toFixed(1)},${home.y.toFixed(1)}`)) continue;
      const seed = Math.random();
      g.items.push({ home, x: home.x, y: home.y, vx: (home.x - cx) * 1.2 + (seed - 0.5) * 220, vy: -160 - Math.random() * 260, rot: 0, vr: (Math.random() - 0.5) * 9, rest: false, seed });
    }
    if (g.mode === 'home') g.mode = 'fall';
    g.asleep = false;
    g.last = performance.now() / 1000;
    el.invalidate();
    onchange(g);
    return rects.length;
  }
  // #endregion drop

  function mode(name) {
    g.mode = name;
    g.asleep = false;
    for (const p of g.items) { p.rest = false; if (name === 'fall') { p.vx = (Math.random() - 0.5) * 200; p.vy = -100; p.vr = (Math.random() - 0.5) * 6; } }
    if (still.matches && name === 'home') { g.items = []; onchange(g); }
    el.invalidate();
  }
  // A new width moves every home rectangle, so put the text back whole.
  let width = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (width && w !== width && g.items.length) { g.items = []; onchange(g); el.invalidate(); }
    width = w;
  }).observe(el);

  return { state: g, drop, mode, source(name) { g.source = name; g.asleep = false; el.invalidate(); } };
}
