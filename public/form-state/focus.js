import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('focusCanvas');
  const field = document.getElementById('focusField');
  const out = document.getElementById('focusOut');
  const cards = [...canvas.querySelectorAll('a.result')].map((el) => ({ el, name: el.textContent.toLowerCase(), away: 0 }));

  // #region focus
  // The paint handler asks whether the field matches :focus and reads its value. The focus ring and each
  // typed letter change the field's picture, which raises `paint`. No focus, blur or input listener is used.
  let focus = 0, last = 0, paints = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const focused = field.matches(':focus'), query = field.value.trim().toLowerCase();
    const ease = 1 - Math.exp(-dt * 9);
    focus += ((focused ? 1 : 0) - focus) * ease;
    let moving = Math.abs((focused ? 1 : 0) - focus) > 0.004;
    if (!moving) focus = focused ? 1 : 0;

    const k = Math.min(1, (w - 16) / 348);
    ctx.translate((w - 348 * k) / 2, 12); ctx.scale(k, k);
    let matches = 0;
    cards.forEach((card, i) => {
      // `away` is 1 for a card that the search has set aside: any card while the field is focused and
      // empty, and a card that does not match once there is a query.
      const match = query && card.name.includes(query);
      if (match) matches++;
      const want = focused && !match ? 1 : query && !match ? 0.6 : 0;
      card.away += (want - card.away) * ease;
      if (Math.abs(want - card.away) > 0.004) moving = true; else card.away = want;
      const x = (i % 2) * 178, y = 66 + Math.floor(i / 2) * 78, s = 1 - card.away * 0.05 + (match ? focus * 0.04 : 0);
      ctx.save();
      ctx.translate(x + 85, y + 34); ctx.scale(s, s); ctx.translate(-85, -34);
      ctx.globalAlpha = 1 - card.away * 0.3;
      ctx.filter = card.away > 0.02 ? `blur(${(card.away * 2.5).toFixed(2)}px)` : 'none';
      put(ctx, card.el, 0, 0);
      ctx.restore();
    });
    // The field, sharp, with a ring drawn by the canvas that widens with focus.
    if (focus > 0.01) {
      ctx.strokeStyle = c.accent; ctx.globalAlpha = focus * 0.35; ctx.lineWidth = 8 * focus;
      ctx.beginPath(); ctx.roundRect(-2, -2, 352, 52, 26); ctx.stroke(); ctx.globalAlpha = 1;
    }
    put(ctx, field, 0, 0);
    out.textContent = `:focus ${focused}, value "${field.value}", ${query ? `${matches} of ${cards.length} match` : 'no query'}. Focus and input listeners: 0. Paint events: ${paints}.`;
    return moving;
  });
  // #endregion focus
  return { stage };
}
