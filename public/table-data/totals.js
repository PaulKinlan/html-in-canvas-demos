import { mount, put, place, colors, clamp } from '/form-state/kit.js';
import { lay, piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('totalsCanvas'), table = document.getElementById('totalsTable'), out = document.getElementById('totalsOut');
  const cell = document.getElementById('totalsSum'), foot = table.tFoot;
  const money = (n) => `£${n.toFixed(2)}`;
  const target = () => [...table.tBodies[0].rows].reduce((sum, row) => sum + Number(row.dataset.price) * Number(row.querySelector('input').value || 0), 0);
  let shown = target(), from = shown, to = shown, t0 = 0;
  cell.textContent = money(shown);
  // #region totals
  // The number in the <tfoot> is real text. When a quantity changes, the script writes a new value into
  // the cell on each frame for 0.6 s, so the text itself counts up or down. The canvas draws the footer
  // row as its own piece while that happens: lifted, larger, with two faint copies above and below it.
  const DURATION = 600;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = clamp((t - t0) / DURATION), rolling = to !== from && u < 1;
    const now = u >= 1 ? to : from + (to - from) * (1 - (1 - u) ** 3);
    if (money(now) !== cell.textContent) cell.textContent = money(now);
    shown = now;
    lay(ctx, canvas, table, w, h, ({ W, H }) => {
      const fy = foot.offsetTop, fh = foot.offsetHeight;
      piece(ctx, table, 0, 0, W, fy);
      if (!rolling) piece(ctx, table, 0, fy, W, H - fy);
      else {
        const lift = Math.sin(u * Math.PI), dir = to > from ? -1 : 1;
        ctx.save();
        ctx.translate(W / 2, fy + fh / 2); ctx.scale(1 + 0.08 * lift, 1 + 0.08 * lift); ctx.translate(-W / 2, -fy - fh / 2);
        for (const [dy, alpha] of [[dir * 16 * lift, 0.14], [dir * 8 * lift, 0.28], [0, 1]]) { ctx.globalAlpha = alpha; piece(ctx, table, 0, fy, W, H - fy, 0, dy); }
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = to > from ? c.ok : c.bad; ctx.fillRect(0, fy + fh - 2, W * u, 2);
      }
      place(ctx, table, 0, 0);
    });
    out.textContent = `Total in the tfoot cell: ${cell.textContent}. ${rolling ? `Counting from ${money(from)} to ${money(to)}.` : 'At rest.'}`;
    return rolling;
  });
  const change = () => { from = shown; to = target(); t0 = performance.now(); stage.request(); };
  table.addEventListener('input', change);
  table.addEventListener('click', (e) => {
    const step = e.target.closest('button[data-step]');
    if (!step) return;
    const input = step.closest('tr').querySelector('input');
    input.value = Math.max(0, Math.min(99, Number(input.value || 0) + Number(step.dataset.step)));
    change();
  });
  // #endregion totals
  return { stage };
}
