import { mount, put, park, scrollRange, colors, clamp, reducedMotion } from './kit.js';

export default function start() {
  const scroller = document.getElementById('noteScroll');
  const canvas = document.getElementById('noteCanvas');
  const doc = document.getElementById('noteDoc');
  const paras = [...doc.querySelectorAll('p')];
  const out = document.getElementById('noteOut');
  // Each aside follows the paragraph it annotates in the markup. angle and length are the pendulum.
  const notes = [...doc.querySelectorAll('aside')].map((el, i) => ({ el, para: el.previousElementSibling, angle: 0, spin: 0, rest: 30 + i * 12, length: 30 + i * 12, stretch: 0 }));
  const GRAVITY = 1500, DRAG = 1.6, SPRING = 90, DAMP = 7;

  let last = 0, lastTop = 0, lastTime = 0, speed = 0, idle = 0;

  // #region aside
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const top = scroller.scrollTop;
    const dt = Math.min(0.033, (t - last) / 1000 || 0);
    last = t;

    for (const p of paras) {
      const y = p.offsetTop - top;
      if (y + p.offsetHeight < 0 || y > h) park(canvas, p); else put(ctx, p, p.offsetLeft, y);
    }

    let moving = false;
    for (const n of notes) {
      // A pendulum on a spring: the angle swings under gravity, the length bounces back to its rest.
      for (let i = 0; i < 2; i++) {
        n.spin += (-(GRAVITY / n.length) * Math.sin(n.angle) - DRAG * n.spin) * dt / 2;
        n.angle += n.spin * dt / 2;
        n.stretch += (-SPRING * (n.length - n.rest) - DAMP * n.stretch) * dt / 2;
        n.length = clamp(n.length + n.stretch * dt / 2, n.rest * 0.5, n.rest * 2.2);
      }
      if (Math.abs(n.angle) + Math.abs(n.spin) * 0.2 + Math.abs(n.length - n.rest) * 0.05 > 0.004) moving = true;
      else { n.angle = 0; n.spin = 0; n.length = n.rest; n.stretch = 0; }

      const W = n.el.offsetWidth, p = n.para;
      const edge = p.offsetLeft + p.offsetWidth + 8, y = p.offsetTop - top;
      const pinX = Math.max(edge + 14 + W / 2, w - 12 - W / 2), pinY = y + 8;
      if (pinY < -n.el.offsetHeight - 120 || pinY > h + 20) { park(canvas, n.el); continue; }
      // A bar beside the paragraph and an arm out to the pin.
      ctx.strokeStyle = c.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(edge, y + p.offsetHeight); ctx.lineTo(edge, pinY); ctx.lineTo(pinX, pinY); ctx.stroke();
      // The string, then the aside turned about the pin. The draw puts its hit region there too.
      ctx.strokeStyle = c.fg; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pinX, pinY); ctx.lineTo(pinX + Math.sin(n.angle) * n.length, pinY + Math.cos(n.angle) * n.length); ctx.stroke();
      ctx.save();
      ctx.translate(pinX, pinY); ctx.rotate(-n.angle);
      put(ctx, n.el, -W / 2, n.length);
      ctx.restore();
      ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(pinX, pinY, 4, 0, 7); ctx.fill();
    }
    return moving;
  });

  // The scroll gives each aside a push. A change in scroll speed kicks the angle sideways (down the
  // page swings it one way, up the other) and stretches the string.
  const push = (change) => {
    if (reducedMotion()) return;
    for (const n of notes) {
      n.spin = clamp(n.spin + change * 2.4, -9, 9);
      n.stretch = clamp(n.stretch + change * 160, -500, 500);
    }
    stage.request();
  };
  scroller.addEventListener('scroll', (e) => {
    const top = scroller.scrollTop, dt = Math.max(4, e.timeStamp - lastTime);
    const now = clamp((top - lastTop) / dt, -3, 3);                  // px per ms
    lastTop = top; lastTime = e.timeStamp;
    push(now - speed);
    speed = now;
    out.textContent = `scrollTop ${Math.round(top)} px, ${Math.round(now * 1000)} px/s.`;
    stage.request();
    clearTimeout(idle);
    idle = setTimeout(() => { push(-speed); speed = 0; }, 90);       // the scroll stopped
  }, { passive: true });
  // #endregion aside

  // A press on an aside pushes it.
  for (const n of notes) n.el.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, label')) { n.spin += 2.6; stage.request(); } });
  doc.addEventListener('change', (e) => { out.textContent = `"${e.target.closest('aside').querySelector('b').textContent}" is ${e.target.checked ? 'checked' : 'not checked'}. The box was pressed where the aside was drawn.`; });
  scrollRange(scroller, canvas, doc);
  return { stage, scroller, notes };
}
