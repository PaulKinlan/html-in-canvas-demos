import { mount, place, colors, clamp } from '/form-state/kit.js';
import { lay, piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('stampCanvas'), table = document.getElementById('stampTable'), out = document.getElementById('stampOut');
  const caption = table.caption, words = caption.firstElementChild;
  const SCALE = 1.9, TURN = -0.26, INK = 'brightness(0) invert(0.45) sepia(1) saturate(30) hue-rotate(-40deg)';
  let t0 = -1e9;
  // #region stamp
  // The caption is a box at the top of the table. The rows are drawn moved up into its place, and the
  // words of the caption are drawn turned, enlarged and in red, across the corner of the table.
  // It comes down from three times its size in 0.25 s.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = clamp((t - t0) / 250), down = t0 > 0;
    lay(ctx, canvas, table, w, h, ({ W, H }) => {
      const ch = caption.offsetHeight;
      // The rows, moved up by half the height of the caption so that they sit in the middle.
      piece(ctx, table, 0, ch, W, H - ch, 0, -ch / 2);
      if (down) {
        // The words of the caption are a <span>, so their box is smaller than the caption's, which is
        // as wide as the table.
        const mx = words.offsetLeft, my = words.offsetTop, mw = words.offsetWidth, mh = words.offsetHeight;
        const s = SCALE * (1 + 2 * (1 - u) ** 2);
        ctx.save();
        ctx.translate(W * 0.56, H * 0.5); ctx.rotate(TURN); ctx.scale(s, s);
        ctx.globalAlpha = u * 0.9;
        ctx.strokeStyle = c.bad; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.roundRect(-mw / 2 - 9, -mh / 2 - 4, mw + 18, mh + 8, 4); ctx.stroke();
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.roundRect(-mw / 2 - 6, -mh / 2 - 1, mw + 12, mh + 2, 2); ctx.stroke();
        // The caption's own pixels. The filter makes every pixel of them one red, whatever the theme.
        ctx.filter = INK;
        piece(ctx, table, mx, my, mw, mh, -mx - mw / 2, -my - mh / 2);
        ctx.restore();
      } else piece(ctx, table, 0, 0, W, ch, 0, -ch / 2);
      // Input goes to the table where its rows are drawn.
      place(ctx, table, 0, -ch / 2);
    });
    out.textContent = down ? `The caption "${words.textContent}" is ${words.offsetWidth} by ${words.offsetHeight} px at the top of the table. It is drawn turned by ${Math.round(-TURN * 180 / Math.PI)} degrees at ${SCALE} times its size.` : 'The caption is above the rows, where the browser puts it.';
    return down && u < 1;
  });
  // #endregion stamp
  document.getElementById('stampGo').addEventListener('click', () => { t0 = performance.now(); stage.request(); });
  document.getElementById('stampOff').addEventListener('click', () => { t0 = -1e9; stage.request(); });
  return { stage };
}
