import { mount, put, park, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('wheelCanvas');
  const select = document.getElementById('wheelSelect');
  const out = document.getElementById('wheelOut');
  const options = [...select.options];
  const R = 104;            // radius of the drum, CSS pixels
  let pos = 3, target = 3;  // which option is at the front, as a fraction
  let velocity = 0, dragging = false;

  // #region wheel
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const itemH = options[0].offsetHeight, itemW = options[0].offsetWidth;
    if (!itemH) {
      // Chrome on Android draws <select multiple> as a button that opens a native list. No list box, no options to draw.
      ctx.fillStyle = c.muted; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('This browser has no list box for select multiple,', w / 2, h / 2 - 10);
      ctx.fillText('so there are no option boxes to draw.', w / 2, h / 2 + 10);
      return false;
    }
    if (!dragging) {
      if (Math.abs(velocity) > 0.002) { target = clamp(target + velocity, 0, options.length - 1); velocity *= 0.92; }
      else target = Math.round(target);
      pos += (target - pos) * 0.2;
    } else pos = target;
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = c.card; ctx.beginPath(); ctx.roundRect(cx - itemW / 2 - 10, cy - R - 6, itemW + 20, 2 * R + 12, 14); ctx.fill();
    ctx.strokeStyle = select.matches(':focus-visible') ? c.accent : c.line; ctx.lineWidth = select.matches(':focus-visible') ? 3 : 1; ctx.stroke();
    // Each <option> is drawn on its own. The angle on the drum gives its height and its place.
    const shown = [];
    options.forEach((option, i) => {
      const angle = (i - pos) * itemH / R;
      if (Math.abs(angle) < Math.PI / 2 - 0.05) shown.push({ option, angle }); else park(canvas, option);
    });
    shown.sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle));
    for (const { option, angle } of shown) {
      const squash = Math.cos(angle);
      ctx.save();
      ctx.translate(cx, cy + R * Math.sin(angle));
      ctx.scale(0.86 + 0.14 * squash, squash);
      ctx.globalAlpha = 0.25 + 0.75 * squash;
      put(ctx, option, -itemW / 2, -itemH / 2);
      ctx.restore();
    }
    return dragging || Math.abs(target - pos) > 0.002 || Math.abs(velocity) > 0.002;
  });
  // #endregion wheel

  // Drag or use the mouse wheel to turn the drum. A tap is left to the option, which selects natively.
  let lastY = 0, moved = 0;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; dragging = true; lastY = e.clientY; moved = 0; velocity = 0; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const itemH = options[0].offsetHeight || 30;
    const d = (lastY - e.clientY) / itemH;
    moved += Math.abs(e.clientY - lastY); lastY = e.clientY;
    target = clamp(target + d, 0, options.length - 1); velocity = d;
    stage.request();
  });
  const release = () => { dragging = false; stage.request(); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); target = clamp(target + Math.sign(e.deltaY), 0, options.length - 1); stage.request(); }, { passive: false });
  select.addEventListener('keyup', () => { if (select.selectedIndex >= 0) { target = select.selectedIndex; stage.request(); } });
  select.addEventListener('focus', () => stage.request());
  select.addEventListener('blur', () => stage.request());

  const report = () => { out.textContent = 'Form data: ' + (new URLSearchParams(new FormData(select.form)).toString() || '(nothing selected)'); stage.request(); };
  select.addEventListener('change', report);
  report();
}
