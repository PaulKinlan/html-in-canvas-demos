import { mount, put, place, colors, clamp, back } from '/form-state/kit.js';
import { piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('heroCanvas'), select = document.getElementById('heroSelect'), out = document.getElementById('heroOut');
  const mirror = select.querySelector('selectedcontent');
  let t0 = performance.now();
  // #region hero
  // A customisable select copies the content of the chosen <option>, markup included, into its
  // <selectedcontent> element. That element is a box inside the picture of the select. The canvas draws
  // the select once at its own size, where it is used, and draws the box of the <selectedcontent> a
  // second time, up to 3.4 times as large, as the heading of the canvas.
  const SCALE = 3.4;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = back(clamp((t - t0) / 420)), sw = select.offsetWidth, sh = select.offsetHeight;
    // Where the mirror is inside the select: both rectangles follow the same draw, so their difference
    // is layout.
    const a = select.getBoundingClientRect(), b = mirror.getBoundingClientRect(), kNow = a.width / sw || 1;
    const box = { x: (b.x - a.x) / kNow, y: (b.y - a.y) / kNow, w: b.width / kNow, h: b.height / kNow };
    const k = Math.min(SCALE, (w - 24) / Math.max(1, box.w));
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, 150);
    if (box.w > 0) {
      ctx.save();
      ctx.translate(w / 2, 75); ctx.scale(k * (0.7 + 0.3 * u), k * (0.7 + 0.3 * u)); ctx.globalAlpha = clamp(u + 0.2);
      piece(ctx, select, box.x, box.y, box.w, box.h, -box.x - box.w / 2, -box.y - box.h / 2);
      ctx.restore();
    }
    ctx.save(); ctx.translate((w - sw) / 2, 176); put(ctx, select, 0, 0); place(ctx, select, 0, 0); ctx.restore();
    out.textContent = `selectedcontent holds "${mirror.textContent.trim()}" in a box of ${Math.round(box.w)} by ${Math.round(box.h)} px, drawn ${k.toFixed(1)} times as large. The select's value is "${select.value}".`;
    return t - t0 < 700;
  });
  // #endregion hero
  select.addEventListener('change', () => { t0 = performance.now(); stage.request(); });
  return { stage };
}
