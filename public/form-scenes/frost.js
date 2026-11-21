import { put, smooth, clamp, reducedMotion } from '/lib/stage-2d.js';
import { scene, seeded, query } from './scene.js';

export default function start() {
  const canvas = document.getElementById('frostCanvas');
  const form = document.getElementById('frostForm');
  const set = document.getElementById('frostSet');
  const lock = document.getElementById('frostLock');
  const out = document.getElementById('frostOut');
  const W = 380, H = 400, X = 30, Y = 30;

  // #region frost-lock
  // The one step: the checkbox in the legend sets `disabled` on the fieldset.
  // Controls inside a fieldset's first legend are not disabled with it, so the lock itself stays usable.
  lock.addEventListener('change', () => { set.disabled = lock.checked; report(); });
  // #endregion frost-lock

  // Ice crystals: lines that start at the edge of the panel and branch on the way in.
  // Each piece has a time (0 to 1) at which it starts to grow.
  const pieces = [];
  const random = seeded(11);
  function branch(x, y, angle, length, at, depth, w, h) {
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const a = angle + (random() - 0.5) * 0.3;
      const nx = x + Math.cos(a) * length / steps, ny = y + Math.sin(a) * length / steps;
      const begin = at + (i - 1) * length / 900;
      pieces.push({ x1: x, y1: y, x2: nx, y2: ny, at: begin, thin: depth > 0 });
      if (depth < 2 && i < steps) for (const side of [-1, 1]) if (random() < 0.7) branch(nx, ny, angle + side * 1.05, length * 0.45 * (1 - i / steps * 0.4), begin + 0.04, depth + 1, w, h);
      x = nx; y = ny;
    }
  }
  function crystals(w, h) {
    pieces.length = 0;
    const edge = [];
    for (let x = 6; x < w; x += 38) edge.push([x, 0], [x + 15, h]);
    for (let y = 10; y < h; y += 38) edge.push([0, y], [w, y + 15]);
    for (const [x, y] of edge) branch(x, y, Math.atan2(h / 2 - y, w / 2 - x) + (random() - 0.5) * 0.9, 36 + random() * 62, random() * 0.35, 0, w, h);
  }

  // #region frost-draw
  let frost = set.disabled ? 1 : 0, last = 0;
  const spots = [];      // places a finger touched the frost: { x, y, from }

  const stage = scene(canvas, W, H, (ctx, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const want = set.disabled ? 1 : 0;
    if (frost !== want) frost = reducedMotion() ? want : want ? Math.min(1, frost + dt / 1.1) : Math.max(0, frost - dt / 0.6);
    const w = set.offsetWidth, h = set.offsetHeight;
    if (!pieces.length && w) crystals(w, h);

    // The fieldset as it is. A disabled fieldset is still drawn, in the browser's disabled colours.
    put(ctx, set, X, Y);
    if (frost <= 0) return false;

    // Where the legend is drawn, from the two drawn boxes. It is left clear of frost.
    const sb = set.getBoundingClientRect(), lb = set.querySelector('legend').getBoundingClientRect();
    const s = w / sb.width || 1;
    const legend = [X + (lb.left - sb.left) * s - 6, Y + (lb.top - sb.top) * s - 4, lb.width * s + 12, lb.height * s + 8];

    ctx.save();
    // Frost covers the panel from the edges inwards: the panel, less a hole in the middle that closes.
    const f = smooth(frost), hole = new Path2D();
    hole.rect(X, Y, w, h);
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const r = (1 - f) * 260 * (0.78 + 0.22 * Math.sin(a * 5 + 1) * Math.cos(a * 3));
      hole[i ? 'lineTo' : 'moveTo'](X + w / 2 + Math.cos(a) * r, Y + h / 2 + Math.sin(a) * r * 0.9);
    }
    ctx.clip(hole, 'evenodd');
    const clear = new Path2D();
    clear.rect(0, 0, W, H); clear.rect(...legend);
    ctx.clip(clear, 'evenodd');

    // The same element drawn a second time through a blur. Then a haze, then the crystals.
    ctx.filter = `blur(${(0.6 + 1.2 * f).toFixed(1)}px)`;
    put(ctx, set, X, Y);
    ctx.filter = 'none';
    const haze = ctx.createRadialGradient(X + w / 2, Y + h / 2, 30, X + w / 2, Y + h / 2, 240);
    haze.addColorStop(0, `rgba(214, 232, 250, ${0.2 * f})`);
    haze.addColorStop(1, `rgba(214, 232, 250, ${0.7 * f})`);
    ctx.fillStyle = haze;
    ctx.fillRect(X, Y, w, h);
    ctx.translate(X, Y);
    for (const [colour, width] of [['rgba(70, 120, 175, 0.35)', 2.2], ['rgba(255, 255, 255, 0.95)', 1]]) {
      ctx.strokeStyle = colour; ctx.lineCap = 'round';
      for (const thin of [false, true]) {
        ctx.lineWidth = thin ? width * 0.6 : width;
        ctx.beginPath();
        for (const p of pieces) {
          if (p.thin !== thin) continue;
          const g = clamp((frost - p.at) / 0.12);
          if (g <= 0) continue;
          ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x1 + (p.x2 - p.x1) * g, p.y1 + (p.y2 - p.y1) * g);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // A touch melts a round patch, which freezes over again. The controls under it are still disabled.
    let more = frost !== want;
    for (let i = spots.length - 1; i >= 0; i--) {
      const age = (t - spots[i].from) / 2600;
      if (age >= 1 || !set.disabled) { spots.splice(i, 1); continue; }
      const r = 34 * (1 - smooth(age));
      ctx.save();
      ctx.beginPath(); ctx.rect(X, Y, w, h); ctx.clip();
      ctx.beginPath(); ctx.arc(spots[i].x, spots[i].y, r, 0, 7); ctx.clip();
      put(ctx, set, X, Y);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(spots[i].x, spots[i].y, r, 0, 7); ctx.stroke();
      more = true;
    }
    return more;
  });
  // #endregion frost-draw

  // #region frost-events
  // A press on a disabled control still reaches the canvas as pointerdown. No click follows on the control.
  let presses = 0, clicks = 0, lastTarget = '';
  canvas.addEventListener('pointerdown', (e) => {
    if (!set.disabled || e.target.closest?.('legend') || !set.contains(e.target)) return;
    const [x, y] = stage.point(e);
    spots.push({ x, y, from: performance.now() });
    presses++;
    lastTarget = e.target.localName;
    report();
  });
  set.addEventListener('click', (e) => { if (set.disabled && !e.target.closest('legend') && e.target !== set) clicks++; report(); });
  // #endregion frost-events

  function report() {
    const controls = [...form.elements].filter((el) => el !== set);
    const off = controls.filter((el) => el.matches(':disabled')).length;
    out.textContent = `${off} of ${controls.length} controls match :disabled. FormData: ${query(form)}`
      + (presses ? `\nPresses on the locked panel: ${presses}, the last on <${lastTarget}>. Click events on its controls: ${clicks}.` : '');
    stage.request();
  }
  form.addEventListener('input', report);
  form.addEventListener('reset', () => setTimeout(report));
  form.addEventListener('submit', (e) => { e.preventDefault(); out.textContent = `Submitted: ${query(form)}`; });
  report();
  return { stage };
}
