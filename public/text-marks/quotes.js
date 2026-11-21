import { mount, put, colors } from '/form-state/kit.js';
import { lay } from './lay.js';

export default function start() {
  const canvas = document.getElementById('quotesCanvas'), sheet = document.getElementById('quotesSheet'), out = document.getElementById('quotesOut');
  const on = document.getElementById('quotesOn');
  let frames = 0;
  // #region quotes
  // getClientRects() of a <q> gives a rectangle for its opening mark, one for each line of its text and
  // one for its closing mark. The canvas paints a band
  // behind those lines, an opening mark at the start of the first rectangle and a closing mark at the
  // end of the last, and a wave under each <cite>. All of it is drawn before the text, so it is behind.
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    let lines = 0;
    lay(ctx, canvas, sheet, w, h, ({ local }) => {
      if (on.checked) {
        for (const q of sheet.querySelectorAll('q')) {
          const rects = [...q.getClientRects()].map(local);
          if (!rects.length) continue;
          lines += rects.length;
          ctx.fillStyle = c.accent; ctx.globalAlpha = 0.12;
          for (const r of rects) { ctx.beginPath(); ctx.roundRect(r.x - 3, r.y + 1, r.w + 6, r.h - 2, 6); ctx.fill(); }
          ctx.globalAlpha = 0.32;
          ctx.font = '700 72px Georgia, serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
          const first = rects[0], end = rects.at(-1);
          ctx.fillText('\u201C', first.x + 4, first.y + 44);
          ctx.fillText('\u201D', end.x + end.w - 4, end.y + 44);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
        for (const cite of sheet.querySelectorAll('cite')) for (const r of [...cite.getClientRects()].map(local)) {
          ctx.beginPath();
          for (let x = 0; x <= r.w; x += 2) ctx.lineTo(r.x + x, r.y + r.h + 1 + Math.sin(x * 0.55) * 1.8);
          ctx.stroke();
        }
      }
      put(ctx, sheet, 0, 0);
    });
    out.textContent = on.checked ? `Marks drawn from ${lines} rectangles of ${sheet.querySelectorAll('q').length} q elements.` : 'The paragraph as the browser draws it.';
    return frames++ < 3;
  });
  // #endregion quotes
  on.addEventListener('change', () => { frames = 0; stage.request(); });
  return { stage };
}
