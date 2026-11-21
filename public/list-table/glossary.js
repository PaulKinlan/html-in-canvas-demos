// Glossary cards from a <dl>, for /list-table/.
// <dt> is the front of a card and <dd> the back. Both are drawable and share one grid cell.
import { mount, put, park, clamp, smooth, reducedMotion } from '/lib/stage-2d.js';

export default function start() {
  const canvas = document.getElementById('dlCanvas');
  const dl = document.getElementById('glossary');
  const out = document.getElementById('dlOut');
  const slow = document.getElementById('dlSlow');
  // One record for each term. `angle` is 0 with the dt facing the reader and PI with the dd facing.
  const cards = [...dl.children].map((el) => ({ el, dt: el.querySelector('dt'), dd: el.querySelector('dd'), button: el.querySelector('button'), from: 0, to: 0, angle: 0, t0: -1e9, settled: false }));

  // #region dl-turn
  function turn(card, delay = 0) {
    card.from = card.angle;
    card.to = card.to === 0 ? Math.PI : 0;
    card.t0 = performance.now() + delay;
    card.settled = false;
    card.button.setAttribute('aria-expanded', String(card.to !== 0));
    stage.request();
  }
  // A click reaches the dt's button or the dd, whichever face was drawn there. A link in the dd is left alone.
  dl.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const card = cards.find((c) => c.el.contains(e.target));
    if (card) turn(card);
  });
  document.getElementById('dlAll').addEventListener('click', () => cards.forEach((card, i) => turn(card, i * 70)));
  // #endregion dl-turn

  // #region dl-strips
  // Draw `el` (w by h) as if turned by `angle` about its vertical centre line, seen from distance D.
  // A 2D context has no perspective, so the element is drawn in n vertical strips. Each strip is the whole
  // element clipped to a narrow band, squeezed sideways and scaled by the depth of that band.
  function turned(ctx, el, cx, cy, w, h, angle, scale, n = 24, D = 560) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const project = (u) => { const k = scale * D / (D - u * sin); return [u * cos * k, k]; };   // u: distance from the centre line
    for (let i = 0; i < n; i++) {
      const u0 = -w / 2 + (w * i) / n, u1 = u0 + w / n;
      const [x0, k0] = project(u0), [x1, k1] = project(u1);
      if (x1 - x0 < 0.02) continue;
      ctx.save();
      ctx.translate(cx + x0, cy);
      ctx.scale((x1 - x0) / (u1 - u0), (k0 + k1) / 2);
      ctx.translate(-(u0 + w / 2), -h / 2);
      ctx.beginPath();
      ctx.rect(u0 + w / 2, 0, w / n + 0.7, h);      // 0.7 px of overlap hides the seams
      ctx.clip();
      put(ctx, el, 0, 0, w, h);
      ctx.restore();
    }
    // The outline of the turned card, for the shade drawn over it.
    const [xl, kl] = project(-w / 2), [xr, kr] = project(w / 2);
    const path = new Path2D();
    path.moveTo(cx + xl, cy - (h / 2) * kl); path.lineTo(cx + xr, cy - (h / 2) * kr);
    path.lineTo(cx + xr, cy + (h / 2) * kr); path.lineTo(cx + xl, cy + (h / 2) * kl);
    path.closePath();
    return path;
  }
  // #endregion dl-strips

  // #region dl-paint
  const stage = mount(canvas, (ctx, w, h, now) => {
    const duration = reducedMotion() ? 0 : slow.checked ? 2600 : 700;
    let moving = false;
    for (const card of cards) {
      const p = duration ? clamp((now - card.t0) / duration) : 1;
      card.angle = p >= 1 ? card.to : card.from + (card.to - card.from) * smooth(p);
      card.lift = Math.sin(card.angle);            // 0 at rest, 1 when the card is edge-on
      if (p < 1) moving = true;
    }
    // Cards that are turning are drawn last, over their neighbours.
    for (const card of [...cards].sort((a, b) => a.lift - b.lift)) {
      const x = card.el.offsetLeft, y = card.el.offsetTop, cw = card.el.offsetWidth, ch = card.el.offsetHeight;
      const front = Math.cos(card.angle) >= 0;
      const face = front ? card.dt : card.dd, hidden = front ? card.dd : card.dt;
      park(canvas, hidden);                        // the face that is not drawn takes no taps
      if (card.angle === card.to) {
        // At rest: one flat draw, which puts the hit box exactly on the card.
        put(ctx, face, x, y, cw, ch);
        if (!card.settled) { card.settled = true; face.toggleAttribute('data-settled'); hidden.toggleAttribute('data-settled'); }   // clears the remembered hit test
        continue;
      }
      const lift = card.lift, cx = x + cw / 2, cy = y + ch / 2 - 8 * lift;
      // A shadow on the cards underneath.
      ctx.save();
      ctx.shadowColor = `rgb(0 0 0 / ${0.35 * lift})`; ctx.shadowBlur = 24 * lift; ctx.shadowOffsetY = 18 * lift;
      ctx.fillStyle = `rgb(0 0 0 / ${0.2 * lift})`;
      ctx.beginPath();
      ctx.roundRect(cx - (cw / 2) * Math.abs(Math.cos(card.angle)), y + 6, cw * Math.abs(Math.cos(card.angle)), ch - 6, 12);
      ctx.fill();
      ctx.restore();
      // The visible face. Past 90 degrees the dd is drawn, turned back by 180 degrees so it is not mirrored.
      const outline = turned(ctx, face, cx, cy, cw, ch, front ? card.angle : card.angle - Math.PI, 1 + 0.1 * lift);
      ctx.fillStyle = `rgb(0 0 0 / ${0.4 * lift * lift})`;
      ctx.fill(outline);
    }
    const back = cards.filter((c) => c.to !== 0).length;
    out.textContent = `${cards.length - back} cards show the dt, ${back} show the dd.${moving ? ' Turning: 24 draws of one element for each card in this frame.' : ' At rest: one draw for each card.'}`;
    return moving;
  });
  // #endregion dl-paint
  window.__listTable = { ...(window.__listTable ?? {}), glossary: { canvas, cards } };
}
