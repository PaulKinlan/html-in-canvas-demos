import { mount, put, place, colors, clamp, smooth } from '/form-state/kit.js';
import { lay } from './lay.js';

export default function start() {
  const canvas = document.getElementById('foldCanvas'), sheet = document.getElementById('foldSheet'), out = document.getElementById('foldOut');
  const button = document.getElementById('foldToggle');
  let target = 0, amount = 0, last = 0, frames = 0;
  // #region fold
  // A <br> is 0 px wide, so there is nothing of it to draw. The lines it makes do have
  // rectangles: a Range over each text node between two breaks. The canvas cuts the sheet at the top of
  // each line and folds the strips like a paper fan: each strip is squashed, sheared one way or the
  // other, and shaded.
  const range = document.createRange();
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - last) / 1000); last = t;
    amount = clamp(amount + Math.sign(target - amount) * dt / 0.7);
    const a = smooth(amount);
    let strips = 0;
    lay(ctx, canvas, sheet, w, h, ({ W, H, local }) => {
      if (a === 0) {
        put(ctx, sheet, 0, 0);
        // Flat: read the line rectangles and mark each break with a dashed cut line.
        const cuts = [];
        for (const node of sheet.childNodes) {
          if (node.nodeType !== 3 || !node.data.trim()) continue;
          range.selectNodeContents(node);
          const r = range.getClientRects()[0];
          if (r) cuts.push(local(r).y);
        }
        cuts.sort((p, q) => p - q);
        stage.cuts = cuts.slice(1).map((y) => Math.round(y));
        ctx.strokeStyle = c.muted; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        for (const y of stage.cuts) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(W - 4, y); ctx.stroke(); }
        ctx.setLineDash([]);
        strips = stage.cuts.length + 1;
        return;
      }
      const edges = [0, ...(stage.cuts ?? []), H];
      strips = edges.length - 1;
      const squash = 1 - 0.72 * a;
      let y = (H - H * squash) / 2;
      for (let i = 0; i < strips; i++) {
        const top = edges[i], sh = edges[i + 1] - top, dir = i % 2 ? 1 : -1, shear = dir * 0.5 * a;
        ctx.save();
        // x' = x + shear * (y - top), y' = y0 + (y - top) * squash
        ctx.transform(1, 0, shear, squash, -dir * 0.25 * a * sh, y);
        ctx.translate(0, -top);
        ctx.beginPath(); ctx.rect(0, top - 0.4, W, sh + 0.8); ctx.clip();
        put(ctx, sheet, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = dir > 0 ? `rgb(0 0 0 / ${0.3 * a})` : `rgb(255 255 255 / ${0.18 * a})`;
        ctx.fillRect(0, top - 1, W, sh + 2);
        ctx.restore();
        y += sh * squash;
      }
      place(ctx, sheet, 0, 0);
    });
    out.textContent = `${strips} strips from ${sheet.querySelectorAll('br').length} br elements. The first br is ${sheet.querySelector('br').offsetWidth} px wide. Fold: ${Math.round(a * 100)}%.`;
    // The rectangles follow the last draw, so the first flat frames are drawn twice.
    return amount !== target || frames++ < 3;
  });
  // #endregion fold
  button.addEventListener('click', () => { target = target ? 0 : 1; button.textContent = target ? 'Unfold' : 'Fold at the line breaks'; last = performance.now(); stage.request(); });
  return { stage };
}
