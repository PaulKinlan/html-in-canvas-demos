import { mount, put, smooth, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('diagramCanvas');
  const svg = document.getElementById('diagramSvg');
  const out = document.getElementById('diagramOut');
  const size = document.getElementById('nodeSize'), detour = document.getElementById('nodeDetour'), arrived = document.getElementById('nodeArrived');
  const W = 360, H = 300;                      // the SVG's layout size, which is also its viewBox
  const edge = Object.fromEntries(['e1', 'e2', 'e3', 'e4'].map((id) => { const path = document.getElementById(id); return [id, { path, length: path.getTotalLength() }]; }));

  // #region diagram
  // A pulse is a point on one of the SVG's own <path> elements. Where a pulse goes next is read from the
  // controls in the nodes when it gets there: the range sets its size and the checkbox picks the edge.
  const pulses = [], rings = [];
  let tilt = 0, last = 0, nextAuto = 0, sent = 0, count = 0, shown = '';
  const send = (delay = 0) => { pulses.push({ on: 'e1', at: -delay * 150, size: 1 }); sent++; };

  const stage = mount(canvas, (ctx, w, h, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (t > nextAuto) { send(); nextAuto = t + 1700; }
    for (const p of pulses) {
      p.at += dt * 150;
      if (p.at < edge[p.on].length) continue;
      p.at -= edge[p.on].length;
      if (p.on === 'e1') { p.on = 'e2'; p.size = Number(size.value); }
      else if (p.on === 'e2') p.on = detour.checked ? 'e4' : 'e3';
      else { p.done = true; count++; rings.push({ born: t, size: p.size }); }
    }
    for (let i = pulses.length - 1; i >= 0; i--) if (pulses[i].done) pulses.splice(i, 1);
    while (rings.length && t - rings[0].born > 600) rings.shift();
    const text = `Pulses sent: ${sent}. Arrived: ${count}. Size at the second node: ${Number(size.value).toFixed(1)}. Route: ${detour.checked ? 'the long edge' : 'the short edge'}.`;
    // The count in the last node is an <output> inside the SVG. It is written after the paint, not during it.
    if (text !== shown) { shown = text; setTimeout(() => { out.textContent = text; arrived.value = String(count); }, 0); }

    // Blueprint paper.
    ctx.fillStyle = '#0b2a4a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgb(255 255 255 / .06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = (w / 2) % 20; x < w; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = (h / 2) % 20; y < h; y += 20) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // One transform for the SVG and for everything the canvas adds to it. With the tilt it is a shear,
    // and the button, the range and the checkbox are still pressed where they are drawn.
    const p = smooth(tilt), k = Math.min(1.3, (w - 12) / W, (h - 12) / H) * (1 - 0.2 * p);
    ctx.translate(w / 2, h / 2);
    ctx.transform(1, 0.26 * p, -0.42 * p, 1 - 0.14 * p, 0, 0);
    ctx.scale(k, k);
    ctx.translate(-W / 2, -H / 2);
    put(ctx, svg, 0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    for (const pulse of pulses) {
      if (pulse.at < 0) continue;
      const e = edge[pulse.on];
      for (let tail = 0; tail < 5; tail++) {
        const at = pulse.at - tail * 7;
        if (at < 0) break;
        const pt = e.path.getPointAtLength(at), r = (5 + 5 * pulse.size) * (1 - tail * 0.15);
        const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 2.2);
        glow.addColorStop(0, `rgb(255 244 200 / ${0.95 - tail * 0.18})`); glow.addColorStop(0.35, `rgb(255 170 60 / ${0.5 - tail * 0.09})`); glow.addColorStop(1, 'rgb(255 120 0 / 0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 2.2, 0, 7); ctx.fill();
      }
    }
    for (const ring of rings) {
      const age = (t - ring.born) / 600;
      ctx.strokeStyle = `rgb(255 200 110 / ${1 - age})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(115 - age * 14, 215 - age * 14, 130 + age * 28, 70 + age * 28, 10 + age * 10); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    return true;
  });
  // #endregion diagram

  // #region diagram-controls
  // The node's button is a real <button> inside <foreignObject>.
  document.getElementById('nodeSend').addEventListener('click', () => { for (let i = 0; i < 5; i++) send(i * 0.12); stage.request(); });
  let busy = null;
  document.getElementById('diagramTilt').addEventListener('click', (e) => {
    const to = tilt > 0.5 ? 0 : 1, from = tilt;
    e.currentTarget.setAttribute('aria-pressed', String(to === 1));
    busy?.();
    busy = tween(600, (p) => { tilt = from + (to - from) * p; stage.request(); });
  });
  // #endregion diagram-controls
  return { stage };
}
