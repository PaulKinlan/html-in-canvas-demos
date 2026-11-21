import { mount, put, place } from './kit.js';

export default function start() {
  const canvas = document.getElementById('dentCanvas');
  const panel = document.getElementById('dentPanel');
  const display = document.getElementById('dentDisplay');
  const out = document.getElementById('dentOut');

  // #region dent
  // The paint handler asks which button matches :active. With a mouse or the keyboard nothing else is
  // needed: the :active style changes the picture, and that raises `paint`. `held` is the second route
  // (see below), for a touch press, which did not set :active on a drawn button in Chromium 157.
  const COLS = 8, ROWS = 9;
  let press = null, depth = 0, last = 0, wasActive = false, byStyle = 0, byListener = 0, held = null;
  const rings = [];
  const line = () => { out.textContent = `Presses the paint handler saw through :active: ${byStyle}. Presses only the pointerdown listener saw: ${byListener}.`; };

  const stage = mount(canvas, (ctx, w, h, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const styled = panel.querySelector('button:active'), active = styled ?? held;
    if (active) press = { x: active.offsetLeft + active.offsetWidth / 2, y: active.offsetTop + active.offsetHeight / 2 };
    if (active && !wasActive) { if (styled) byStyle++; else byListener++; line(); }
    // Letting go starts a ring that travels outward from the button.
    if (!active && wasActive && press) { rings.push({ ...press, born: t }); if (rings.length > 3) rings.shift(); }
    wasActive = !!active;
    depth += ((active ? 1 : 0) - depth) * (1 - Math.exp(-dt * 22));
    while (rings.length && t - rings[0].born > 1100) rings.shift();
    const still = depth < 0.005 && !rings.length;

    const W = panel.offsetWidth, H = panel.offsetHeight;
    const k = Math.min(1, (w - 16) / W, (h - 16) / H);
    ctx.translate((w - W * k) / 2, (h - H * k) / 2); ctx.scale(k, k);
    if (still) { put(ctx, panel, 0, 0); return false; }

    // The panel is drawn as a mesh. Each corner of the grid is moved: towards the pressed key while it is
    // held, and along the ring after it is let go. Each cell is two triangles, and each triangle is the
    // same element, clipped, with the affine transform that takes its three corners to their moved places.
    const at = (col, row) => {
      const x = col * W / COLS, y = row * H / ROWS;
      let mx = x, my = y;
      if (press && depth > 0.005) {
        const dx = press.x - x, dy = press.y - y, pull = depth * 0.3 * Math.exp(-((Math.hypot(dx, dy) / 85) ** 2));
        mx += dx * pull; my += dy * pull;
      }
      for (const ring of rings) {
        const age = (t - ring.born) / 1000, dx = x - ring.x, dy = y - ring.y, r = Math.hypot(dx, dy) || 1, d = r - age * 330;
        const wave = Math.sin(d / 16) * Math.exp(-((d / 44) ** 2)) * Math.exp(-age * 2.2) * 9;
        mx += dx / r * wave; my += dy / r * wave;
      }
      return [x, y, mx, my];
    };
    const grid = [];
    for (let row = 0; row <= ROWS; row++) for (let col = 0; col <= COLS; col++) grid.push(at(col, row));
    const corner = (col, row) => grid[row * (COLS + 1) + col];
    const triangle = (p0, p1, p2) => {
      const [x0, y0, u0, v0] = p0, [x1, y1, u1, v1] = p1, [x2, y2, u2, v2] = p2;
      const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det, cc = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
      const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
      // The clip is 0.6 px larger than the triangle, so that no line shows between neighbours.
      const gx = (u0 + u1 + u2) / 3, gy = (v0 + v1 + v2) / 3;
      const out = (u, v) => { const l = Math.hypot(u - gx, v - gy) || 1; return [u + (u - gx) / l * 0.6, v + (v - gy) / l * 0.6]; };
      ctx.save();
      ctx.beginPath(); ctx.moveTo(...out(u0, v0)); ctx.lineTo(...out(u1, v1)); ctx.lineTo(...out(u2, v2)); ctx.closePath(); ctx.clip();
      ctx.transform(a, b, cc, d, u0 - a * x0 - cc * y0, v0 - b * x0 - d * y0);
      put(ctx, panel, 0, 0);
      ctx.restore();
    };
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      triangle(corner(col, row), corner(col + 1, row), corner(col, row + 1));
      triangle(corner(col + 1, row + 1), corner(col, row + 1), corner(col + 1, row));
    }
    // Shade inside the pixels of the panel only: dark in the dent, a light and a dark band on each ring.
    ctx.globalCompositeOperation = 'source-atop';
    if (press && depth > 0.005) {
      const shade = ctx.createRadialGradient(press.x, press.y, 0, press.x, press.y, 110);
      shade.addColorStop(0, `rgb(0 0 0 / ${depth * 0.5})`); shade.addColorStop(0.6, `rgb(0 0 0 / ${depth * 0.22})`); shade.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
    }
    for (const ring of rings) {
      const age = (t - ring.born) / 1000, r = age * 330, fade = Math.exp(-age * 2.2);
      ctx.lineWidth = 12;
      ctx.strokeStyle = `rgb(255 255 255 / ${fade * 0.22})`; ctx.beginPath(); ctx.arc(ring.x, ring.y, r + 6, 0, 7); ctx.stroke();
      ctx.strokeStyle = `rgb(0 0 0 / ${fade * 0.25})`; ctx.beginPath(); ctx.arc(ring.x, ring.y, Math.max(0, r - 8), 0, 7); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Input goes to the flat panel, whatever the last triangle's transform was.
    place(ctx, panel, 0, 0);
    return true;
  });
  // #endregion dent

  // #region dent-touch
  // The second route. A pointerdown on a key is remembered and a paint is asked for. The paint handler
  // uses it only when no button matches :active, and counts the two routes separately.
  panel.addEventListener('pointerdown', (e) => { held = e.target.closest?.('button') ?? null; if (held) stage.request(); });
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => { if (held) { held = null; stage.request(); } });
  // #endregion dent-touch

  // The keypad's own job: a click adds the digit. This is the application, not the effect.
  panel.addEventListener('click', (e) => {
    const key = e.target.closest('button')?.value;
    if (!key) return;
    display.value = key === 'clear' ? '' : (display.value + key).slice(-12);
  });
  line();
  return { stage };
}
