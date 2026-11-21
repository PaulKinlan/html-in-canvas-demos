import { mount, put, smooth, lerp, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('mathCanvas');
  const steps = [...canvas.querySelectorAll('.step')];
  const out = document.getElementById('mathOut');
  let from = 0, to = 0, p = 1;

  // Boxes of the terms that carry data-k, relative to their step.
  const terms = (step) => {
    const o = step.getBoundingClientRect();
    return new Map([...step.querySelectorAll('[data-k]')].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.dataset.k, { x: r.x - o.x - 2, y: r.y - o.y - 2, w: r.width + 4, h: r.height + 4 }];
    }));
  };
  // Draw one box of a step, moved by dx, dy.
  const piece = (ctx, step, b, dx, dy, alpha, y0) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(dx, dy);
    ctx.beginPath(); ctx.rect(b.x, y0 + b.y, b.w, b.h); ctx.clip();
    put(ctx, step, 0, y0);
    ctx.restore();
  };

  // #region math
  const stage = mount(canvas, (ctx, w, h) => {
    const a = steps[from], b = steps[to];
    const y0 = Math.round((h - b.offsetHeight) / 2);
    if (p >= 1) { put(ctx, b, 0, y0); return false; }
    const e = smooth(p), A = terms(a), B = terms(b);
    // What the new line has that is not a tracked term (a fraction bar, for one) fades in.
    ctx.save();
    ctx.globalAlpha = e * e;
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    for (const t of B.values()) ctx.rect(t.x, y0 + t.y, t.w, t.h);
    ctx.clip('evenodd');
    put(ctx, b, 0, y0);
    ctx.restore();
    for (const [key, s] of A) {
      const d = B.get(key);
      if (!d) { piece(ctx, a, s, 0, -18 * e, 1 - e, y0); continue; }
      // A term in both lines: the old picture travels to the new place and the new picture arrives with it.
      const dx = d.x + d.w / 2 - s.x - s.w / 2, dy = d.y + d.h / 2 - s.y - s.h / 2;
      const hop = -26 * Math.sin(Math.PI * e) * Math.sign(dx);
      piece(ctx, a, s, lerp(0, dx, e), lerp(0, dy, e) + hop, 1 - e, y0);
      piece(ctx, b, d, lerp(-dx, 0, e), lerp(-dy, 0, e) + hop, e, y0);
    }
    for (const [key, d] of B) if (!A.has(key)) piece(ctx, b, d, 0, 18 * (1 - e), e, y0);
    return false;
  });
  // #endregion math

  let cancel = null;
  function go(next) {
    if (next < 0 || next >= steps.length || next === to) return;
    cancel?.();
    from = to; to = next;
    out.textContent = `Line ${to + 1} of ${steps.length}`;
    cancel = tween(900, (v) => { p = v; stage.request(); });
  }
  document.getElementById('mathNext').addEventListener('click', () => go(to + 1 < steps.length ? to + 1 : 0));
  document.getElementById('mathBack').addEventListener('click', () => go(to - 1));
  out.textContent = `Line 1 of ${steps.length}`;
}
