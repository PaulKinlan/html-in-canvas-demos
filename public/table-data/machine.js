import { mount, put, colors, clamp } from '/form-state/kit.js';
import { lay } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('machineCanvas'), sheet = document.getElementById('machineSheet'), out = document.getElementById('machineOut');
  const hold = document.getElementById('machineHold'), keep = document.getElementById('machineKeep');
  const items = [...sheet.querySelectorAll('time, data')];
  let target = 0, amount = 0, last = 0, frames = 0;
  // #region machine
  // Each <time> has a datetime attribute and each <data> a value attribute: the form of the same fact
  // that a program reads. While the button is held, the canvas writes that attribute above the element,
  // in a tag with a pointer, at the element's client rectangle.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - last) / 1000); last = t;
    amount = clamp(amount + Math.sign(target - amount) * dt / 0.18);
    lay(ctx, canvas, sheet, w, h, ({ W, local }) => {
      put(ctx, sheet, 0, 0);
      if (!amount) return;
      ctx.font = '12px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      items.forEach((el, i) => {
        const r = el.getClientRects()[0]; if (!r) return;
        const b = local(r), text = el.getAttribute(el.localName === 'time' ? 'datetime' : 'value');
        const a = clamp(amount * 1.6 - i * 0.1), tw = ctx.measureText(text).width + 14;
        const x = Math.min(W - tw / 2 - 2, Math.max(tw / 2 + 2, b.x + b.w / 2)), y = b.y - 13 + (1 - a) * 8;
        ctx.globalAlpha = a;
        ctx.fillStyle = c.accent; ctx.fillRect(b.x, b.y + b.h - 1, b.w, 2);
        ctx.fillStyle = el.localName === 'time' ? '#1d4ed8' : '#7c2d12';
        ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 10, tw, 20, 6); ctx.fill();
        ctx.beginPath(); ctx.moveTo(b.x + b.w / 2 - 5, y + 9); ctx.lineTo(b.x + b.w / 2 + 5, y + 9); ctx.lineTo(b.x + b.w / 2, y + 15); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(text, x, y + 0.5);
        ctx.globalAlpha = 1;
      });
    });
    out.textContent = target ? `Showing ${items.length} attributes: ${items.map((el) => el.getAttribute(el.localName === 'time' ? 'datetime' : 'value')).join(', ')}.` : 'Hold the button, or hold the M key.';
    return amount !== target || frames++ < 3;
  });
  // #endregion machine
  const set = (on) => { const next = on || keep.checked ? 1 : 0; if (next === target) return; target = next; last = performance.now(); stage.request(); };
  hold.addEventListener('pointerdown', () => set(true));
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) hold.addEventListener(type, () => set(false));
  hold.addEventListener('contextmenu', (e) => e.preventDefault());
  keep.addEventListener('change', () => set(false));
  addEventListener('keydown', (e) => { if (e.key === 'm' && !e.repeat && !e.target.matches?.('input:not([type=checkbox]), textarea, [contenteditable]')) set(true); });
  addEventListener('keyup', (e) => { if (e.key === 'm') set(false); });
  return { stage };
}
