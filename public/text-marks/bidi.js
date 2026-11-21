import { mount, put, colors } from '/form-state/kit.js';
import { lay } from './lay.js';

export default function start() {
  const canvas = document.getElementById('bidiCanvas'), sheet = document.getElementById('bidiSheet'), out = document.getElementById('bidiOut');
  const runs = [...sheet.querySelectorAll('bdi, bdo, span.ltr')];
  let frames = 0;
  // #region bidi
  // For each run, one Range per character gives the rectangle where that character is drawn. The canvas
  // writes the character's number in the text above it, and draws an arrow from the first character of
  // the run to the last. In a right-to-left run the numbers count down along the line.
  const range = document.createRange();
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), found = [];
    lay(ctx, canvas, sheet, w, h, ({ local }) => {
      put(ctx, sheet, 0, 0);
      ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (const run of runs) {
        const text = run.firstChild, centres = [];
        for (let i = 0; i < text.length; i++) {
          range.setStart(text, i); range.setEnd(text, i + 1);
          const r = range.getClientRects()[0];
          if (!r || !r.width) continue;
          const b = local(r);
          centres.push({ n: i + 1, x: b.x + b.w / 2, y: b.y });
        }
        if (centres.length < 2) continue;
        const first = centres[0], last = centres.at(-1), rtl = last.x < first.x, y = first.y - 16;
        ctx.fillStyle = c.muted;
        for (const ch of centres) if (ch.n % 2 === 1) ctx.fillText(String(ch.n), ch.x, ch.y - 2);
        ctx.strokeStyle = ctx.fillStyle = rtl ? c.accent : c.ok; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(first.x, y); ctx.lineTo(last.x, y); ctx.stroke();
        const d = rtl ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(last.x, y); ctx.lineTo(last.x + d * 8, y - 5); ctx.lineTo(last.x + d * 8, y + 5); ctx.fill();
        found.push(`${run.localName}${run.dir ? ` dir=${run.dir}` : ''}: ${centres.length} characters, drawn ${rtl ? 'right to left' : 'left to right'}`);
      }
    });
    out.textContent = found.join('. ') + '.';
    // The rectangles follow the last draw, so the first frames are drawn twice.
    return frames++ < 3;
  });
  // #endregion bidi
  return { stage };
}
