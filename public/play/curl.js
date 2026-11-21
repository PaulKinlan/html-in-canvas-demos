import { mount, put, place, park, fresh, clamp, ease } from './kit.js';

export default function start() {
  const canvas = document.getElementById('curlCanvas');
  const leaves = [...canvas.querySelectorAll('.leaf')];
  const grip = document.getElementById('curlGrip');
  const slider = document.getElementById('curlHold');
  const prev = document.getElementById('curlPrev'), next = document.getElementById('curlNext');
  const out = document.getElementById('curlOut');
  const W = 300, H = 380;               // the size of a page in CSS pixels

  let page = 0;                         // the page on top
  let P = { x: W, y: H };               // where the bottom right corner of that page is now
  let goal = null;                      // where the corner is heading: { x, y, then }
  let held = null;                      // the pointer that holds the corner
  let last = 0, k = 1, ox = 0, oy = 0, paints = 0;

  // #region curl-geometry
  // The corner travels on this path when a button or the slider moves it: 0 is flat, 1 is turned over.
  const path = (t) => ({ x: W - 2 * W * t, y: H - Math.sin(Math.PI * t) * H * 0.3 });
  const rest = () => (page < leaves.length - 1 ? path(Math.max(0.02, slider.value / 100)) : { x: W, y: H });
  // Paper does not stretch: the corner stays within one page width of the bottom of the spine and within
  // one diagonal of the top of the spine.
  const limit = (p) => {
    let { x, y } = p;
    const pull = (cx, cy, max) => { const d = Math.hypot(x - cx, y - cy); if (d > max) { x = cx + (x - cx) * max / d; y = cy + (y - cy) * max / d; } };
    pull(0, H, W); pull(0, 0, Math.hypot(W, H)); pull(0, H, W);
    return { x, y };
  };
  // The part of a polygon on one side of the fold line through m with normal n.
  const cut = (poly, m, n, sign) => {
    const res = [], side = (p) => ((p[0] - m.x) * n.x + (p[1] - m.y) * n.y) * sign;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], da = side(a), db = side(b);
      if (da >= 0) res.push(a);
      if ((da >= 0) !== (db >= 0)) { const f = da / (da - db); res.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    });
    return res;
  };
  const trace = (ctx, poly) => { ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  // #endregion curl-geometry

  const line = () => {
    const el = leaves[page], n = el.textContent.length;
    out.textContent = `Page ${page + 1} of ${leaves.length}, ${n} characters. The corner is ${Math.round(Math.hypot(W - P.x, H - P.y))} px from flat. Paint events: ${paints}.`;
  };

  // #region curl-draw
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    let moving = false;
    if (goal && !held) {
      // x goes straight to the goal. y follows the path, so the page lifts in the middle of a turn.
      P.x = ease(P.x, goal.x, dt, 7);
      P.y = ease(P.y, path((W - P.x) / (2 * W)).y, dt, 16);
      P = limit(P);
      if (Math.abs(P.x - goal.x) < 1.2) { P = { x: goal.x, y: goal.y }; const then = goal.then; goal = null; then?.(); }
      moving = true;
    }
    k = Math.min(1, (w - 36) / W, (h - 28) / H); ox = (w - W * k) / 2 + 8 * k; oy = (h - H * k) / 2;
    ctx.translate(ox, oy); ctx.scale(k, k);
    const top = leaves[page], under = leaves[page + 1];
    const rect = [[0, 0], [W, 0], [W, H], [0, H]];

    // The block of pages under the top one, and the spine.
    ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.roundRect(-16, -8, W + 26, H + 18, 8); ctx.fill();
    for (let i = 3; i >= 1; i--) { ctx.fillStyle = i % 2 ? '#e9e1cc' : '#d8cfb6'; ctx.fillRect(i * 1.5, i * 1.5, W, H); }
    if (under) put(ctx, under, 0, 0, W, H); else { ctx.fillStyle = '#8a6a45'; ctx.fillRect(0, 0, W, H); }

    const dx = W - P.x, dy = H - P.y, d = Math.hypot(dx, dy);
    if (d < 0.5) {
      put(ctx, top, 0, 0, W, H);
    } else {
      // The fold line is half way between the corner's flat place and where the corner is now.
      const m = { x: (W + P.x) / 2, y: (H + P.y) / 2 }, n = { x: dx / d, y: dy / d };
      const flat = cut(rect, m, n, -1), lifted = cut(rect, m, n, 1);
      const mn = m.x * n.x + m.y * n.y;
      const mirror = ([x, y]) => { const s = 2 * (x * n.x + y * n.y - mn); return [x - s * n.x, y - s * n.y]; };
      const back = lifted.map(mirror);
      // Shadow of the lifted part on the page below.
      if (lifted.length > 2) {
        ctx.save(); trace(ctx, lifted); ctx.clip();
        const g = ctx.createLinearGradient(m.x, m.y, m.x + n.x * Math.min(60, d * 0.6), m.y + n.y * Math.min(60, d * 0.6));
        g.addColorStop(0, 'rgb(0 0 0 / 0.38)'); g.addColorStop(1, 'rgb(0 0 0 / 0)');
        ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
        ctx.restore();
      }
      // 1. The part of the top page that is still flat.
      if (flat.length > 2) {
        ctx.save(); trace(ctx, flat); ctx.clip();
        put(ctx, top, 0, 0, W, H);
        // The shadow that the lifted part casts on it.
        ctx.shadowColor = 'rgb(0 0 0 / 0.45)'; ctx.shadowBlur = 22;
        ctx.fillStyle = '#000'; trace(ctx, back); ctx.fill();
        ctx.restore();
      }
      // 2. The back of the lifted part: the same element, drawn again mirrored about the fold line.
      if (back.length > 2) {
        ctx.save(); trace(ctx, back); ctx.clip();
        ctx.save();
        ctx.transform(1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, 2 * mn * n.x, 2 * mn * n.y);
        put(ctx, top, 0, 0, W, H);
        ctx.restore();
        // Paper over the mirrored text, so that it reads as ink seen through the sheet, and the shading of a bend.
        ctx.fillStyle = 'rgb(250 246 233 / 0.8)'; ctx.fillRect(-W * 2, -H, W * 4, H * 3);
        const half = d / 2, g = ctx.createLinearGradient(m.x, m.y, m.x - n.x * half, m.y - n.y * half);
        g.addColorStop(0, 'rgb(0 0 0 / 0.30)'); g.addColorStop(0.18, 'rgb(0 0 0 / 0.04)'); g.addColorStop(0.5, 'rgb(255 255 255 / 0.35)'); g.addColorStop(1, 'rgb(0 0 0 / 0.16)');
        ctx.fillStyle = g; ctx.fillRect(-W * 2, -H, W * 4, H * 3);
        ctx.restore();
      }
    }
    // Rings of the spine.
    for (let y = 26; y < H; y += 36) { ctx.strokeStyle = '#3b2a18'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-12, y); ctx.lineTo(8, y); ctx.stroke(); }

    // Input. The top page takes it at its flat place, whatever was drawn last. The pages that are not
    // on top are parked. The grip is placed last, so it is above the page where the corner is.
    for (const el of leaves) if (el !== top) park(canvas, el);
    place(ctx, top, 0, 0);
    if (under) place(ctx, grip, clamp((W + P.x) / 2 - 48, -20, W - 86), clamp((H + P.y) / 2 - 48, 0, H - 86)); else park(canvas, grip);
    line();
    return moving;
  });
  // #endregion curl-draw
  if (stage.plain) { grip.remove(); return { stage }; }
  addEventListener('play-plain', () => grip.remove());

  const buttons = () => { prev.disabled = page === 0; next.disabled = page === leaves.length - 1; slider.disabled = page === leaves.length - 1; };
  // If the page that was turned away had the caret, the new top page takes it, so typing goes to the page that shows.
  const settle = () => {
    fresh(grip, ...leaves); buttons(); stage.request();
    const had = leaves.includes(document.activeElement) && document.activeElement !== leaves[page];
    if (had) leaves[page].focus({ preventScroll: true });
  };
  const turnForward = () => {
    if (page >= leaves.length - 1 || goal?.forward) return;
    goal = { x: -W, y: H, forward: true, then: () => { page++; P = { x: W, y: H }; goal = { ...rest() }; settle(); } };
    stage.request();
  };
  const turnBack = () => {
    if (page === 0 || goal?.forward) return;
    page--; P = { x: -W, y: H }; goal = { ...rest() };
    settle();
  };
  next.addEventListener('click', turnForward);
  prev.addEventListener('click', turnBack);
  slider.addEventListener('input', () => { if (!held) { goal = { ...rest() }; stage.request(); } });

  // #region curl-grip
  // The grip is a transparent drawable element over the corner, with touch-action: none. The page
  // under it keeps pan-y. The corner follows the pointer and is held inside the limits of the paper.
  grip.addEventListener('pointerdown', (e) => {
    if (held || page >= leaves.length - 1) return;
    const r = canvas.getBoundingClientRect();
    held = { id: e.pointerId, dx: P.x - ((e.clientX - r.left - ox) / k), dy: P.y - ((e.clientY - r.top - oy) / k) };
    grip.setPointerCapture(e.pointerId);
    goal = null;
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!held || e.pointerId !== held.id) return;
    const r = canvas.getBoundingClientRect();
    P = limit({ x: Math.min(W, (e.clientX - r.left - ox) / k + held.dx), y: (e.clientY - r.top - oy) / k + held.dy });
    stage.request();
  });
  const release = (e) => {
    if (!held || e.pointerId !== held.id) return;
    held = null;
    // Past the middle of the page the turn finishes. Before it, the corner goes back to where the slider holds it.
    if (P.x < W * 0.3 && e.type === 'pointerup') turnForward(); else { goal = { ...rest() }; stage.request(); }
    fresh(grip);
  };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);
  // #endregion curl-grip

  P = rest();
  buttons();
  return { stage, state: () => ({ page, P: { ...P } }) };
}
