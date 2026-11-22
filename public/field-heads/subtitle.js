import { mount, put, colors, clamp, back } from '/form-state/kit.js';
import { lay, piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('subtitleCanvas'), group = document.getElementById('subtitleGroup'), out = document.getElementById('subtitleOut');
  const heading = group.querySelector('h3'), sub = group.querySelector('p');
  let t0 = performance.now(), lines = null, total = 0, seen = false;
  // #region subtitle
  // The <hgroup> is one drawable block. Its heading drops into place first. Then the <p> under it is
  // shown one character at a time: the canvas draws the block clipped to the part of each line that has
  // been reached, with a block cursor after it. The lines come from a Range over each character, read
  // once with the block flat.
  const SETTLE = 600, PER = 38;
  function measure(local) {
    const text = sub.firstChild, r = document.createRange(), found = [];
    for (let i = 0; i < text.length; i++) {
      r.setStart(text, i); r.setEnd(text, i + 1);
      const q = r.getClientRects()[0];
      if (!q) continue;
      const b = local(q), line = found.at(-1);
      if (line && Math.abs(line.y - b.y) < b.h / 2) line.ends.push(b.x + b.w); else found.push({ x: b.x, y: b.y, h: b.h, ends: [b.x + b.w] });
    }
    return found;
  }
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), T = t - t0, drop = back(clamp(T / SETTLE));
    let shown = 0;
    lay(ctx, canvas, group, w, h, ({ W, local }) => {
      const hh = sub.offsetTop;
      if (!lines) {
        // First frames: the block flat, so that the rectangles can be read on the next one.
        put(ctx, group, 0, 0);
        if (seen) { lines = measure(local); total = lines.reduce((n, l) => n + l.ends.length, 0); }
        return;
      }
      ctx.save(); ctx.globalAlpha = clamp(T / 250); piece(ctx, group, 0, 0, W, hh, 0, (drop - 1) * 60); ctx.restore();
      shown = Math.floor(clamp((T - SETTLE) / PER, 0, total));
      let left = shown, cursor = null;
      for (const line of lines) {
        const n = Math.min(left, line.ends.length); left -= n;
        if (n > 0) { piece(ctx, group, line.x - 1, line.y, line.ends[n - 1] - line.x + 1, line.h); cursor = { x: line.ends[n - 1] + 2, y: line.y, h: line.h }; }
      }
      if (cursor && (shown < total || Math.floor(T / 400) % 2 === 0)) { ctx.fillStyle = c.accent; ctx.fillRect(cursor.x, cursor.y + 2, 9, cursor.h - 4); }
    });
    seen = true;
    out.textContent = lines ? `Heading in place: ${T >= SETTLE ? 'yes' : 'no'}. Characters of the subtitle shown: ${shown} of ${total}, on ${lines.length} lines.` : 'Measuring.';
    return !lines || T < SETTLE + total * PER + 2400;
  });
  // #endregion subtitle
  document.getElementById('subtitleAgain').addEventListener('click', () => { t0 = performance.now(); stage.request(); });
  return { stage };
}
