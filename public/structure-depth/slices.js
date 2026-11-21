import { mount, put, onPoint, colors, clamp, reducedMotion, interactive } from './kit.js';

export default function start() {
  const canvas = document.getElementById('slicesCanvas');
  const doc = document.getElementById('slicesDoc');
  const spread = document.getElementById('slicesSpread');
  const sway = document.getElementById('slicesSway');
  const out = document.getElementById('slicesOut');
  // How far each slice is from the reader. Positive is nearer.
  const DEPTH = [-1, 0.9, -0.25, 0.55, -0.7, 0.3];

  let tilt = 0.6, drag = null, active = 0, regions = [], cuts = [];

  // #region slices
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const W = doc.offsetWidth, H = doc.offsetHeight;
    // Cut the article under each <hr>. offsetTop is measured from the article, which is positioned.
    cuts = [0, ...[...doc.querySelectorAll('hr')].map((hr) => hr.offsetTop + hr.offsetHeight), H];
    const n = cuts.length - 1;
    const amount = spread.value / 100;
    const moving = sway.checked && amount > 0 && !reducedMotion() && !drag;
    const tx = tilt + (moving ? 0.45 * Math.sin(t / 1300) : 0), ty = moving ? 0.7 * Math.cos(t / 1700) : 0.4;
    const k = Math.min(1, (w - 64) / W, (h - 56) / H);

    regions = [];
    for (let i = 0; i < n; i++) {
      const z = DEPTH[i % DEPTH.length] * amount;
      const scale = k * (1 + 0.16 * z);
      const x = w / 2 + tx * 42 * z - W / 2 * scale;
      const y = h / 2 + ty * 14 * z + (i - (n - 1) / 2) * 12 * amount - H / 2 * scale;
      regions.push({ i, z, matrix: new DOMMatrix().translate(x, y).scale(scale), x, y: y + cuts[i] * scale, w: W * scale, h: (cuts[i + 1] - cuts[i]) * scale });
    }
    // Far slices first. Each slice is the whole article, clipped to the rows between two cuts.
    for (const r of [...regions].sort((p, q) => p.z - q.z)) {
      const lift = 6 + 10 * Math.max(0, r.z + amount);
      ctx.fillStyle = `rgb(0 0 0 / ${0.16 * amount})`;
      ctx.fillRect(r.x + lift * 0.6, r.y + lift, r.w, r.h);
      ctx.save();
      ctx.transform(r.matrix.a, 0, 0, r.matrix.d, r.matrix.e, r.matrix.f);
      ctx.beginPath(); ctx.rect(0, cuts[r.i], W, cuts[r.i + 1] - cuts[r.i]); ctx.clip();
      put(ctx, doc, 0, 0, W, H);
      ctx.fillStyle = `rgb(0 0 0 / ${0.28 * Math.max(0, -r.z)})`;        // far slices are darker
      ctx.fillRect(0, cuts[r.i], W, cuts[r.i + 1] - cuts[r.i]);
      ctx.restore();
      ctx.strokeStyle = c.line; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    // The article has one hit region. It goes to the slice that the pointer was last on.
    stage.hit(doc, regions[Math.min(active, n - 1)].matrix);
    return moving || !!drag;
  });
  // #endregion slices

  // #region slices-point
  // Before a tap is handled, and when a mouse moves, find the nearest slice under the pointer and move
  // the article's hit region to it. The tap then lands on the button or link drawn there.
  onPoint(canvas, (x, y) => {
    const on = [...regions].sort((p, q) => q.z - p.z).find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (!on || stage.plain) return;
    active = on.i;
    stage.hit(doc, on.matrix);
    doc.toggleAttribute('data-point');          // clears Chromium's remembered hit-test answer
    say();
  });
  // #endregion slices-point

  canvas.addEventListener('pointerdown', (e) => {
    if (stage.plain || interactive(e.target)) return;
    drag = { x: e.clientX, tilt, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    tilt = clamp(drag.tilt + (e.clientX - drag.x) / 90, -2, 2);
    stage.request();
  });
  const release = (e) => { if (drag && e.pointerId === drag.id) { drag = null; stage.request(); } };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const say = () => { out.textContent = `${cuts.length - 1} slices, cut at ${cuts.slice(1, -1).map(Math.round).join(', ')} px of ${Math.round(cuts.at(-1) ?? 0)}. Input goes to slice ${active + 1}.${likes ? ` Liked ${likes} times.` : ''}`; };
  let likes = 0;
  document.getElementById('slicesLike').addEventListener('click', (e) => { e.target.textContent = `Like (${++likes})`; say(); });
  spread.addEventListener('input', () => stage.request());
  sway.addEventListener('change', () => stage.request());
  doc.addEventListener('change', say);
  requestAnimationFrame(() => requestAnimationFrame(say));
  return { stage, get regions() { return regions; }, get active() { return active; } };
}
