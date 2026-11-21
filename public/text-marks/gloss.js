import { mount, put, park, colors, clamp, smooth } from '/form-state/kit.js';
import { lay, piece } from './lay.js';

export default function start() {
  const canvas = document.getElementById('glossCanvas'), sheet = document.getElementById('glossSheet'), gloss = document.getElementById('glossText'), out = document.getElementById('glossOut');
  const abbrs = [...sheet.querySelectorAll('abbr')];
  let open = null, target = 0, amount = 0, last = 0, view = null;
  // #region gloss
  // The title of an <abbr> is shown by the browser as a tooltip, which is not part of the picture and
  // does not exist on a touch screen. Here a tap cuts the paragraph under the line of the abbreviation,
  // moves the lower piece down, and draws the title in the gap. The title is a real element, #glossText.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - last) / 1000); last = t;
    amount = clamp(amount + Math.sign(target - amount) * dt / 0.28);
    const a = smooth(amount);
    lay(ctx, canvas, sheet, w, h, (v) => {
      view = v;
      const { W, H } = v;
      if (!open || a === 0) { put(ctx, sheet, 0, 0); park(canvas, gloss); return; }
      const cut = open.offsetTop + open.offsetHeight + 3, gh = gloss.offsetHeight + 10, gap = gh * a;
      piece(ctx, sheet, 0, 0, W, cut);
      piece(ctx, sheet, 0, cut, W, H - cut, 0, gap);
      // The title, in the gap.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, cut, W, gap); ctx.clip();
      ctx.globalAlpha = a;
      put(ctx, gloss, 12, cut + 5 - (1 - a) * gh);
      ctx.restore();
      // A bracket from the abbreviation to its title.
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.globalAlpha = a;
      ctx.strokeRect(open.offsetLeft - 3, open.offsetTop - 1, open.offsetWidth + 6, open.offsetHeight + 2);
      ctx.beginPath(); ctx.moveTo(open.offsetLeft + open.offsetWidth / 2, open.offsetTop + open.offsetHeight + 1); ctx.lineTo(open.offsetLeft + open.offsetWidth / 2, cut + 5 * a); ctx.stroke();
      ctx.globalAlpha = 1;
      view.cut = cut; view.gap = gap;
    });
    out.textContent = open && target ? `Open: ${open.textContent}. Its title attribute is drawn in a gap ${Math.round((gloss.offsetHeight + 10) * a)} px tall.` : 'Tap an abbreviation.';
    if (amount === 0 && !target) open = null;
    return amount !== target;
  });
  const toggle = (abbr) => {
    if (open === abbr && target) target = 0;
    else { if (open !== abbr) amount = 0; open = abbr; gloss.textContent = `${abbr.textContent}: ${abbr.title}`; target = 1; }
    for (const a of abbrs) a.setAttribute('aria-expanded', String(a === open && target === 1));
    last = performance.now(); stage.request();
  };
  // The paragraph is drawn in two pieces at two places, so the canvas finds the abbreviation itself:
  // the tap in sheet pixels, moved back up by the gap if it is below the cut.
  canvas.addEventListener('click', (e) => {
    if (!view) return;
    const r = canvas.getBoundingClientRect();
    let x = (e.clientX - r.x - view.x) / view.k, y = (e.clientY - r.y - view.y) / view.k;
    if (open && view.gap && y > view.cut) { if (y < view.cut + view.gap) return; y -= view.gap; }
    const hit = abbrs.find((a) => x >= a.offsetLeft - 6 && x <= a.offsetLeft + a.offsetWidth + 6 && y >= a.offsetTop - 6 && y <= a.offsetTop + a.offsetHeight + 6);
    if (hit) toggle(hit); else if (target) toggle(open);
  });
  // #endregion gloss
  for (const a of abbrs) a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(a); } });
  return { stage };
}
