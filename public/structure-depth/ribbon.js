import { mount, put, hitOnly, park, colors, clamp, reducedMotion } from './kit.js';

export default function start() {
  const canvas = document.getElementById('ribbonCanvas');
  const nav = document.getElementById('ribbonNav');
  const links = [...nav.querySelectorAll('a')];
  const still = document.getElementById('ribbonStill');
  const out = document.getElementById('ribbonOut');
  const STEP = 4, AMP = 34, WAVE = 230, BAND = 54, GAP = 6, END = 26;

  let scroll = 0, vel = 0, drag = null, phase = 0.6, last = 0, range = 0, want = null;

  // #region ribbon
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const waving = !still.checked && !reducedMotion();
    if (waving) phase += dt * 1.1;
    if (!drag) { scroll += vel * dt; vel *= Math.exp(-dt * 3.5); }

    // The curve, as points 3 px apart with the length of the curve up to each one.
    const pts = [];
    let len = 0, zero = 0;
    for (let x = -60; x <= w + 60; x += 3) {
      const y = h / 2 + AMP * Math.sin(x / WAVE * Math.PI * 2 + phase) + AMP * 0.35 * Math.sin(x / WAVE * Math.PI * 5.1 - phase * 1.7);
      if (pts.length) len += Math.hypot(3, y - pts.at(-1).y);
      if (x === 0) zero = len;
      pts.push({ x, y, s: len });
    }
    const seen = pts.find((p) => p.x >= w).s - zero;      // length of curve inside the canvas
    // The point and the angle of the curve at a distance s along it, measured from the left edge.
    const along = (s) => {
      s = clamp(s + zero, 0, len - 0.01);
      let i = 1;
      while (pts[i].s < s) i++;
      const p = pts[i - 1], q = pts[i], f = (s - p.s) / (q.s - p.s);
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, a: Math.atan2(q.y - p.y, q.x - p.x) };
    };

    // The links sit one after another along the ribbon.
    let total = END;
    const starts = links.map((a) => { const s = total; total += a.offsetWidth + GAP; return s; });
    total += END - GAP;
    range = Math.max(0, total - seen);
    if (range === 0) scroll = (total - seen) / 2;                           // it all fits: centre it
    else {
      if (want) { scroll = clamp(starts[want.i] + want.w / 2 - seen / 2, 0, range); vel = 0; want = null; }
      if (scroll < 0 || scroll > range) { scroll = clamp(scroll, 0, range); vel = 0; }
    }

    // The band: one four-sided piece per step, lighter where it rises and darker where it falls.
    const from = Math.max(-scroll, -40), to = Math.min(total - scroll, seen + 40);
    for (let s = from; s < to; s += STEP) {
      const p = along(s), q = along(Math.min(to, s + STEP + 0.6));
      const light = 46 - Math.sin(p.a) * 20;
      ctx.fillStyle = `hsl(14 68% ${light}%)`;
      ctx.beginPath();
      for (const [pt, side] of [[p, -1], [q, -1], [q, 1], [p, 1]]) ctx.lineTo(pt.x - Math.sin(pt.a) * side * BAND / 2, pt.y + Math.cos(pt.a) * side * BAND / 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let s = from + 3; s < to - 2; s += STEP) { const p = along(s); ctx.lineTo(p.x - Math.sin(p.a) * side * (BAND / 2 - 5), p.y + Math.cos(p.a) * side * (BAND / 2 - 5)); }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Each link, cut into 4 px strips. Each strip is turned to the angle of the curve at its place.
    links.forEach((a, i) => {
      const W = a.offsetWidth, H = a.offsetHeight, s0 = starts[i] - scroll;
      if (s0 + W < -30 || s0 > seen + 30) { park(canvas, a); return; }
      for (let u = 0; u < W; u += STEP) {
        const p = along(s0 + u + STEP / 2);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.translate(-(u + STEP / 2), -H / 2);
        ctx.beginPath(); ctx.rect(u - 0.3, 0, STEP + 0.6, H); ctx.clip();
        put(ctx, a, 0, 0, W, H);
        ctx.restore();
      }
      // One hit region for the link: its box, turned to the angle of the curve at its middle.
      const m = along(s0 + W / 2);
      ctx.save();
      ctx.translate(m.x, m.y); ctx.rotate(m.a);
      hitOnly(ctx, a, -W / 2, -H / 2);
      ctx.restore();
    });
    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif';
    if (range > 0) ctx.fillText(scroll < range - 1 ? 'Drag sideways for more links' : 'Drag back', 10, h - 10);
    return waving || !!drag || Math.abs(vel) > 3;
  });
  // #endregion ribbon

  // #region ribbon-drag
  // A sideways drag pulls the ribbon through the canvas. A tap that did not move is left alone, so it
  // follows the link in the ordinary way.
  canvas.addEventListener('pointerdown', (e) => {
    if (stage.plain) return;
    drag = { x: e.clientX, scroll, id: e.pointerId, moved: 0, t: e.timeStamp, lastX: e.clientX };
    vel = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.moved < 8) return;
    if (!canvas.hasPointerCapture(e.pointerId)) canvas.setPointerCapture(e.pointerId);
    const dt = Math.max(1, e.timeStamp - drag.t);
    vel = -(e.clientX - drag.lastX) / dt * 1000;
    drag.t = e.timeStamp; drag.lastX = e.clientX;
    scroll = clamp(drag.scroll - dx, 0, range);
    stage.request();
  });
  let dragged = false;
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    dragged = drag.moved >= 8;
    if (!dragged) vel = 0;
    drag = null;
    setTimeout(() => { dragged = false; }, 60);
    stage.request();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  nav.addEventListener('dragstart', (e) => e.preventDefault());
  // Tab to a link that is outside the canvas: pull the ribbon so that it is in the middle.
  nav.addEventListener('focusin', (e) => {
    const i = links.indexOf(e.target);
    if (i >= 0 && e.target.matches(':focus-visible')) { want = { i, w: e.target.offsetWidth }; stage.request(); }
  });
  // #endregion ribbon-drag

  const tell = (a) => { out.textContent = a ? `<a href="${a.getAttribute('href')}"> "${a.textContent}". A tap follows it. A long press or a right click opens the browser's own link menu.` : 'Point at a link, or move to one with Tab.'; };
  nav.addEventListener('pointerover', (e) => tell(e.target.closest('a')));
  nav.addEventListener('focusin', (e) => tell(e.target.closest('a')));
  still.addEventListener('change', () => stage.request());
  tell(null);
  return { stage, links };
}
