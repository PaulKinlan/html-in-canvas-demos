import { mount, put, place, clamp } from '/form-state/kit.js';
import { lay, piece } from './lay.js';

export default function start() {
  const canvas = document.getElementById('settleCanvas'), sheet = document.getElementById('settleSheet'), out = document.getElementById('settleOut');
  const parts = [...sheet.querySelectorAll('sub, sup')];
  let t0 = performance.now();
  // #region settle
  // The sheet is drawn with a hole at the box of every <sub> and <sup>. Each of those boxes is then
  // drawn as a piece of the same picture: a subscript falls into its hole from above and a superscript
  // rises into it from below, one after another, with a bounce.
  const bounce = (u) => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75; if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375; return n * (u -= 2.625 / d) * u + 0.984375; };
  const STEP = 0.16, FALL = 0.7;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const T = (t - t0) / 1000;
    let landed = 0;
    lay(ctx, canvas, sheet, w, h, ({ W, H }) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H);
      for (const p of parts) ctx.rect(p.offsetLeft - 1, p.offsetTop - 1, p.offsetWidth + 2, p.offsetHeight + 2);
      ctx.clip('evenodd');
      put(ctx, sheet, 0, 0);
      ctx.restore();
      parts.forEach((p, i) => {
        const u = clamp((T - 0.3 - i * STEP) / FALL);
        if (u >= 1) landed++;
        if (u <= 0) return;
        const from = p.localName === 'sub' ? -60 : 60;
        ctx.globalAlpha = Math.min(1, u * 5);
        piece(ctx, sheet, p.offsetLeft - 1, p.offsetTop - 1, p.offsetWidth + 2, p.offsetHeight + 2, 0, from * (1 - bounce(u)));
        ctx.globalAlpha = 1;
      });
      // Input goes to the whole sheet at its flat place.
      place(ctx, sheet, 0, 0);
    });
    out.textContent = `${parts.length} sub and sup elements, each with a box from offsetLeft, offsetTop, offsetWidth and offsetHeight. In place: ${landed}.`;
    return landed < parts.length;
  });
  // #endregion settle
  document.getElementById('settleAgain').addEventListener('click', () => { t0 = performance.now(); stage.request(); });
  return { stage };
}
