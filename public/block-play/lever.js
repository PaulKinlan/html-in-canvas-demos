import { mount, colors, clamp } from '/form-state/kit.js';
import { piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('leverCanvas'), details = document.getElementById('leverDetails'), out = document.getElementById('leverOut');
  const summary = details.querySelector('summary'), body = details.querySelector('.blind');
  let u = 0, target = 0, drag = false, last = 0, pivot = { x: 0, y: 0 }, knob = { x: 0, y: 0 };
  // #region lever
  // u goes from 0 (lever to the left, details closed) to 1 (lever to the right, details open). The
  // details element is open whenever u is above 0, and its content is drawn clipped to a part of its
  // height, so the lever unrolls it. A click or Enter on the summary sends the lever to the other end.
  const SWING = 0.75, ARM = 84;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!drag && u !== target) u = target > u ? Math.min(target, u + dt / 0.4) : Math.max(target, u - dt / 0.4);
    const open = u > 0.01;
    if (details.open !== open) details.open = open;
    const W = details.offsetWidth, k = Math.min(1, (w - 24) / W), sh = summary.offsetHeight, bh = open ? body.offsetHeight : 0, shown = sh + bh * u;
    ctx.save();
    ctx.translate((w - W * k) / 2, 14); ctx.scale(k, k);
    piece(ctx, details, 0, 0, W, shown);
    if (open) {
      // The rod at the bottom edge of the part that is unrolled, and the two cords that hold it.
      ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.roundRect(-6, shown - 3, W + 12, 9, 4); ctx.fill();
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, sh); ctx.lineTo(6, shown); ctx.moveTo(W - 6, sh); ctx.lineTo(W - 6, shown); ctx.stroke();
    }
    ctx.restore();
    // The lever: a plate, an arm on a pivot and a knob.
    const a = (u * 2 - 1) * SWING;
    pivot = { x: w / 2, y: h - 22 }; knob = { x: pivot.x + Math.sin(a) * ARM, y: pivot.y - Math.cos(a) * ARM };
    ctx.fillStyle = c.line; ctx.beginPath(); ctx.roundRect(pivot.x - 96, pivot.y - 12, 192, 24, 12); ctx.fill();
    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText('closed', pivot.x - 86, pivot.y); ctx.textAlign = 'right'; ctx.fillText('open', pivot.x + 86, pivot.y);
    ctx.strokeStyle = '#8a8f98'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(knob.x, knob.y); ctx.stroke();
    ctx.fillStyle = '#4b5563'; ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 9, 0, 7); ctx.fill();
    ctx.fillStyle = drag ? '#ef4444' : '#dc2626'; ctx.beginPath(); ctx.arc(knob.x, knob.y, 17, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(knob.x - 5, knob.y - 6, 5, 0, 7); ctx.fill();
    out.textContent = `details.open is ${details.open}. Lever at ${Math.round(u * 100)}%. Content shown: ${Math.round(bh * u)} of ${bh} px.`;
    return drag || u !== target;
  });
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onKnob = (p) => Math.hypot(p.x - knob.x, p.y - knob.y) < 34;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || !onKnob(at(e))) return;
    drag = true; canvas.setPointerCapture(e.pointerId); stage.request();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = at(e);
    u = clamp((Math.atan2(p.x - pivot.x, Math.max(10, pivot.y - p.y)) / SWING + 1) / 2);
    stage.request();
  });
  const drop = () => { if (!drag) return; drag = false; target = u > 0.5 ? 1 : 0; last = performance.now(); stage.request(); };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);
  // A finger that starts on the knob must not scroll the page.
  canvas.addEventListener('touchstart', (e) => { const r = canvas.getBoundingClientRect(), f = e.touches[0]; if (e.target === canvas && onKnob({ x: f.clientX - r.left, y: f.clientY - r.top })) e.preventDefault(); }, { passive: false });
  summary.addEventListener('click', (e) => { e.preventDefault(); target = target ? 0 : 1; last = performance.now(); stage.request(); });
  // #endregion lever
  return { stage };
}
