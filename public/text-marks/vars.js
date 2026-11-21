import { mount, put, colors, clamp } from '/form-state/kit.js';
import { lay } from './lay.js';

export default function start() {
  const canvas = document.getElementById('varsCanvas'), sheet = document.getElementById('varsSheet'), out = document.getElementById('varsOut');
  const all = [...sheet.querySelectorAll('var')];
  let name = null, since = 0;
  // #region vars
  // A tap or a hover on one <var> picks its name. The canvas outlines every <var> with that text, in the
  // sentence and in the code, and joins them with a line. The boxes come from getClientRects().
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), a = clamp((t - since) / 350);
    let n = 0;
    lay(ctx, canvas, sheet, w, h, ({ local }) => {
      put(ctx, sheet, 0, 0);
      if (!name) return;
      const boxes = all.filter((v) => v.textContent === name).map((v) => local(v.getClientRects()[0] ?? v.getBoundingClientRect()));
      n = boxes.length;
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      boxes.forEach((b, i) => {
        const x = b.x + b.w / 2, y = b.y + b.h / 2;
        if (!i) { ctx.moveTo(x, y); return; }
        const p = boxes[i - 1], px = p.x + p.w / 2, py = p.y + p.h / 2;
        ctx.lineTo(px + (x - px) * a, py + (y - py) * a);
        ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const b of boxes) {
        const grow = 6 * (1 - a);
        ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.roundRect(b.x - 4 - grow, b.y - 1 - grow, b.w + 8 + grow * 2, b.h + 2 + grow * 2, 6); ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
      }
    });
    out.textContent = name ? `var "${name}": ${n} places outlined.` : 'Tap a variable.';
    return name && a < 1;
  });
  const pick = (v) => { const next = v ? v.textContent : null; if (next === name) return; name = next; since = performance.now(); stage.request(); };
  sheet.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') pick(e.target.closest('var')); });
  sheet.addEventListener('click', (e) => pick(e.target.closest('var')));
  sheet.addEventListener('focusin', (e) => pick(e.target.closest('var')));
  // #endregion vars
  return { stage };
}
