// Paint event inspector: counts the paint events that name each element, and
// draws a flash, a count and a strip of recent events for it.
import { plate } from './stage.js';

// #region count
/**
 * Listen to a drawable canvas's paint events. `event.changedElements` lists
 * the drawable elements whose picture changed. Elements that never change are
 * never listed, so the inspector cannot be the thing that decides what to draw.
 */
export function paintInspector(canvas, { keep = 4000 } = {}) {
  const stats = new Map(); // element -> { count, times: [ms, …], last }
  const totals = { events: 0, empty: 0, times: [] };
  const entry = (el) => {
    let s = stats.get(el);
    if (!s) stats.set(el, (s = { count: 0, times: [], last: -Infinity }));
    return s;
  };
  const onPaint = (event) => {
    const now = performance.now(), changed = event.changedElements ?? [];
    totals.events++;
    totals.times.push(now);
    if (!changed.length) totals.empty++;
    for (const el of changed) {
      const s = entry(el);
      s.count++;
      s.last = now;
      s.times.push(now);
    }
  };
  canvas.addEventListener('paint', onPaint);
  const trim = (times, now) => { while (times.length && times[0] < now - keep) times.shift(); };
  return {
    stats, totals, keep,
    of: entry,
    /** Events naming `el` in the last second. Pass no element for all paint events. */
    rate(el, now = performance.now()) {
      const times = el ? entry(el).times : totals.times;
      trim(times, now);
      let n = 0;
      for (let i = times.length - 1; i >= 0 && times[i] > now - 1000; i--) n++;
      return n;
    },
    reset() { stats.clear(); totals.events = totals.empty = 0; totals.times.length = 0; },
    stop() { canvas.removeEventListener('paint', onPaint); },
  };
}
// #endregion count

// #region draw-inspector
const rateColour = (rate) => (rate === 0 ? '#8b93a7' : rate <= 3 ? '#3ddc84' : rate <= 20 ? '#ffb020' : '#ff4d6d');

/**
 * Draw what the inspector knows about one element over and under the place it
 * was drawn. `rect` is in the context's units: { x, y, width, height }.
 * The strip under the element is the last `keep` milliseconds, newest on the right.
 */
export function drawPaintInfo(ctx, inspector, el, rect, { now = performance.now(), label = '', flash = true } = {}) {
  const s = inspector.of(el), rate = inspector.rate(el, now), colour = rateColour(rate);
  const age = now - s.last;
  ctx.save();
  // The flash: a tint and an outline that fade over 350 ms after each paint event that named the element.
  if (flash && age < 350) {
    const a = 1 - age / 350;
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.3 * a;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.globalAlpha = a;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x - 1.5, rect.y - 1.5, rect.width + 3, rect.height + 3);
    ctx.globalAlpha = 1;
  }
  // The strip: one tick per event.
  const sy = rect.y + rect.height + 4, sh = 10;
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fillRect(rect.x, sy, rect.width, sh);
  ctx.fillStyle = colour;
  for (const t of s.times) {
    const x = rect.x + rect.width * (1 - (now - t) / inspector.keep);
    if (x >= rect.x) ctx.fillRect(Math.min(x, rect.x + rect.width - 1.5), sy, 1.5, sh);
  }
  // The count.
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#c9cfdd';
  ctx.fillText(label, rect.x, sy + sh + 4, rect.width);
  plate(ctx, `${s.count} · ${rate}/s`, rect.x + rect.width - 4, rect.y - 7, { fill: colour, color: '#10131f', maxX: rect.x + rect.width + 4, height: 16, font: '700 10px ui-monospace, Menlo, Consolas, monospace', pad: 4 });
  ctx.restore();
  return { count: s.count, rate };
}
// #endregion draw-inspector
