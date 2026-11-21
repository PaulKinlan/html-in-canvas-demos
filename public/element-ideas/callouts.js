import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('calloutCanvas');
  const spots = [...canvas.querySelectorAll('button.spot')];
  // Where each button sits on the drawing, in the drawing's own coordinates.
  const at = [[-78, -8], [4, -40], [74, 30]];

  // #region callouts
  mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const swing = Math.sin(t / 1400) * 0.32, bob = Math.sin(t / 900) * 8;
    ctx.save();
    ctx.translate(w / 2, h / 2 + 24 + bob);
    ctx.rotate(swing);
    // A camera, drawn with canvas paths.
    ctx.fillStyle = c.card; ctx.strokeStyle = c.fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-110, -50, 220, 110, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-30, -66, 70, 18, 5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-78, -8, 34, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(-78, -8, 22, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(40, 6, 68, 44, 6); ctx.stroke();
    const m = ctx.getTransform();
    ctx.restore();
    // Each button is drawn upright at its point on the moving drawing. Its popover is positioned by CSS
    // against the button (position-area: top), and follows because anchor positioning uses the drawn place.
    const dpr = canvas.width / canvas.clientWidth || 1;
    spots.forEach((spot, i) => {
      const p = new DOMPoint(at[i][0], at[i][1]).matrixTransform(m);
      put(ctx, spot, p.x / dpr - spot.offsetWidth / 2, p.y / dpr - spot.offsetHeight / 2);
    });
    return true;
  });
  // #endregion callouts

  for (const spot of spots) {
    const pop = document.getElementById(spot.getAttribute('popovertarget'));
    pop.addEventListener('toggle', (e) => spot.setAttribute('aria-expanded', e.newState === 'open'));
  }
  // Open the first one when the demo starts, so the motion can be seen without a tap.
  // showPopover() needs `source` to make the button the anchor; a tap on the button does that by itself.
  document.getElementById(spots[0].getAttribute('popovertarget')).showPopover?.({ source: spots[0] });
}
