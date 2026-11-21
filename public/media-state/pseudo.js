import { mount, put, place } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('pseudoCanvas');
  const quote = document.getElementById('pseudoQuote');
  const out = document.getElementById('pseudoOut');
  const lift = document.getElementById('pseudoLift');

  // #region ask
  // What the proposal would allow, tried once: hand the pseudo-element itself to drawElementImage().
  let asked = 'not tried';
  const ask = (ctx) => {
    try {
      if (typeof quote.pseudo !== 'function') { asked = 'this browser has no Element.pseudo()'; return; }
      ctx.drawElementImage(quote.pseudo('::before'), 0, 0, 56, 56);
      asked = 'drawElementImage(quote.pseudo("::before")) drew the mark';
    } catch (e) { asked = `drawElementImage(quote.pseudo("::before")) threw ${e.name}`; }
  };
  // #endregion ask

  // #region pseudo
  // The way round it. The mark is a ::before box at a place the style sheet fixes: the first 56 by 56
  // pixels of the quote. The quote is drawn twice with a clip each time: once for the mark, turned and
  // five times as large, and once for the text. It works only because the page knows where the box is.
  const MARK = 56;
  const stage = mount(canvas, (ctx, w, h) => {
    if (asked === 'not tried') { ctx.save(); ask(ctx); ctx.restore(); }
    const qw = quote.offsetWidth, qh = quote.offsetHeight;
    const x = Math.max(8, (w - qw) / 2), y = (h - qh) / 2 + 8;
    if (!lift.checked) put(ctx, quote, x, y);
    else {
      const s = 5;
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5); ctx.rotate(-0.22); ctx.scale(s, s); ctx.translate(-MARK / 2, -MARK / 2 + 4);
      ctx.beginPath(); ctx.rect(0, 0, MARK, MARK); ctx.clip();
      ctx.globalAlpha = 0.3;
      put(ctx, quote, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(x + MARK / 2 + 4, y - 4, qw - MARK, qh + 8); ctx.clip();
      put(ctx, quote, x - MARK / 2, y);
      ctx.restore();
      // Input goes to the place of the text.
      place(ctx, quote, x - MARK / 2, y);
    }
    out.textContent = `${asked}. ${lift.checked ? 'The mark and the text are two clipped draws of one element.' : 'The quote is drawn once, as the style sheet laid it out.'}`;
  });
  // #endregion pseudo
  lift.addEventListener('change', () => stage.request());
  return { stage };
}
