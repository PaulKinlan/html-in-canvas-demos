import { mount, put, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('liquidCanvas');
  const bar = document.getElementById('liquidBar');
  const out = document.getElementById('liquidOut');

  // #region liquid
  // progress.position is read in the paint handler: 0 to 1, or -1 when the bar is indeterminate.
  let level = Math.max(0, bar.position), speed = 0, slosh = 0, last = 0, paints = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const unknown = bar.position < 0, target = unknown ? 0.5 : bar.position;
    // The level is a spring. A change in level stirs the surface, and the stir dies away.
    speed += ((target - level) * 60 - speed * 9) * dt; level += speed * dt;
    slosh = Math.max(slosh * Math.exp(-dt * 1.6), Math.min(1, Math.abs(speed) * 2.2), unknown ? 0.8 : 0);
    const moving = Math.abs(target - level) > 0.001 || Math.abs(speed) > 0.004 || slosh > 0.02;

    const W = bar.offsetWidth, H = bar.offsetHeight;
    const k = Math.min(1, (w - 24) / W);
    ctx.translate((w - W * k) / 2, (h - H * k) / 2); ctx.scale(k, k);
    // The element is drawn first, on an empty canvas. source-atop then keeps the liquid inside the pixels
    // the element painted, so the tank has the element's own rounded outline.
    put(ctx, bar, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    const top = H - clamp(level, 0, 1.05) * H, time = t / 1000;
    const surface = (x) => top + slosh * (7 * Math.sin(x / 34 + time * 5.2) + 4 * Math.sin(x / 15 - time * 7.9)) + slosh * 10 * Math.sin(time * 3.1) * (x / W - 0.5);
    for (const [shift, alpha] of [[0.9, 0.45], [0, 1]]) {
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) ctx.lineTo(x, surface(x + shift * 40) - shift * 5);
      ctx.lineTo(W, H); ctx.closePath();
      const fill = ctx.createLinearGradient(0, top, 0, H);
      fill.addColorStop(0, c.accent); fill.addColorStop(1, '#7a2a05');
      ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.fill();
    }
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
    for (let i = 0; i < 9; i++) {
      const rise = (time * (0.18 + i * 0.023) + i * 0.37) % 1, y = H - rise * (H - top);
      if (y > top + 6) { ctx.beginPath(); ctx.arc(W * (0.08 + i * 0.105) + Math.sin(time * 2 + i) * 4, y, 2 + (i % 3), 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = c.fg; ctx.font = '600 26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(unknown ? 'working' : `${Math.round(bar.position * 100)}%`, W / 2, H + 26);
    out.textContent = `progress.position ${bar.position.toFixed(2)}, read in the paint handler. Paint events: ${paints}.`;
    return moving;
  });
  // #endregion liquid

  // The buttons only change the element. They do not ask the canvas to repaint.
  const set = (v) => { bar.value = clamp(v, 0, 100); };
  let timer = 0;
  document.getElementById('liquidAdd').addEventListener('click', () => set((bar.position < 0 ? 0 : bar.value) + 15));
  document.getElementById('liquidEmpty').addEventListener('click', () => { clearInterval(timer); set(0); });
  document.getElementById('liquidUnknown').addEventListener('click', () => { clearInterval(timer); bar.removeAttribute('value'); });
  document.getElementById('liquidUpload').addEventListener('click', () => {
    clearInterval(timer); set(0);
    timer = setInterval(() => { set(bar.value + 3 + Math.random() * 9); if (bar.value >= 100) clearInterval(timer); }, 350);
  });
  return { stage };
}
