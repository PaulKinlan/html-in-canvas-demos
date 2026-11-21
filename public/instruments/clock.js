import { mount, put, hitOnly, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('clockCanvas');
  const input = document.getElementById('clockInput');
  const grip = document.getElementById('clockGrip');
  const out = document.getElementById('clockOut');

  // #region clock
  const minutes = () => (Number.isFinite(input.valueAsNumber) ? input.valueAsNumber / 60000 : null);
  let target = minutes() ?? 0, shown = target, last = 0, dragging = null;
  let geo = { cx: 0, cy: 0, k: 1 };

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    target = minutes() ?? target;
    // The hands run through every minute between the old value and the new one, as when a watch is set.
    if (dragging) shown = target; else shown += (target - shown) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - shown) < 0.02) shown = target;

    const k = Math.min(1, w / 380), cx = w / 2, cy = 128 * k + 6, R = 112 * k;
    geo = { cx, cy, k };
    // The face is dark at night and light by day, from the value.
    const day = Math.max(0, Math.sin((shown / 1440 - 0.25) * Math.PI * 2));
    const mix = (a, b) => Math.round(a + (b - a) * day);
    ctx.fillStyle = `rgb(${mix(22, 250)}, ${mix(27, 246)}, ${mix(48, 232)})`;
    ctx.strokeStyle = c.line; ctx.lineWidth = 4 * k;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.stroke();
    const ink = day > 0.5 ? '#16181d' : '#f2f2f2';
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    ctx.font = `600 ${15 * k}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let n = 1; n <= 60; n++) {
      const a = n / 60 * Math.PI * 2, sin = Math.sin(a), cos = -Math.cos(a), hour = n % 5 === 0;
      ctx.lineWidth = (hour ? 3 : 1) * k;
      ctx.beginPath(); ctx.moveTo(cx + sin * (R - (hour ? 12 : 6) * k), cy + cos * (R - (hour ? 12 : 6) * k)); ctx.lineTo(cx + sin * (R - 2 * k), cy + cos * (R - 2 * k)); ctx.stroke();
      if (hour) ctx.fillText(String(n / 5), cx + sin * (R - 26 * k), cy + cos * (R - 26 * k));
    }
    ctx.font = `${12 * k}px system-ui`;
    ctx.fillText(shown % 1440 < 720 ? 'AM' : 'PM', cx, cy + 40 * k);
    const hand = (a, length, width, colour) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.strokeStyle = colour; ctx.lineWidth = width * k; ctx.lineCap = 'round';
      ctx.shadowColor = '#0005'; ctx.shadowBlur = 5 * k; ctx.shadowOffsetY = 2 * k;
      ctx.beginPath(); ctx.moveTo(0, 12 * k); ctx.lineTo(0, -length * k); ctx.stroke();
      ctx.restore();
    };
    hand(shown / 720 * Math.PI * 2, 58, 7, ink);
    hand(shown / 60 * Math.PI * 2, 92, 4, c.accent);
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(cx, cy, 6 * k, 0, 7); ctx.fill();

    // An invisible element over the face takes the drag. The time input is drawn under the face, as it is.
    ctx.save(); ctx.translate(cx - R, cy - R); ctx.scale(k, k); hitOnly(ctx, grip); ctx.restore();
    put(ctx, input, cx - input.offsetWidth / 2, cy + R + 14 * k);
    return shown !== target;
  });
  // #endregion clock

  // #region clock-drag
  // Dragging a hand writes the input's value. The hand nearer to the pointer's angle is the one that moves.
  const write = (m) => {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    input.value = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const turnOf = (e) => { const b = canvas.getBoundingClientRect(); return (Math.atan2(e.clientX - b.left - geo.cx, -(e.clientY - b.top - geo.cy)) / (Math.PI * 2) + 1) % 1; };
  const apart = (a, b) => Math.abs(((a - b + 1.5) % 1) - 0.5);
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    const turn = turnOf(e), now = minutes() ?? 0;
    dragging = apart(turn, (now / 720) % 1) < apart(turn, (now / 60) % 1) ? 'hour' : 'minute';
    move(e);
  });
  const move = (e) => {
    if (!dragging) return;
    const turn = turnOf(e), now = minutes() ?? 0;
    if (dragging === 'minute') {
      // Passing 12 with the minute hand carries into the hour.
      let d = Math.round(turn * 60) % 60 - now % 60;
      if (d > 30) d -= 60; else if (d < -30) d += 60;
      write(now + d);
    } else {
      let d = turn * 720 - now % 720;
      if (d > 360) d -= 720; else if (d < -360) d += 720;
      write(Math.round((now + d) / 5) * 5);
    }
    navigator.vibrate?.(4);
  };
  grip.addEventListener('pointermove', move);
  const release = () => { if (dragging) { dragging = null; input.dispatchEvent(new Event('change', { bubbles: true })); } };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);
  // #endregion clock-drag

  const report = () => { out.textContent = `Form value: at=${input.value || '(empty)'}`; stage.request(); };
  input.addEventListener('input', report);
  document.getElementById('clockNow').addEventListener('click', () => { const d = new Date(); write(d.getHours() * 60 + d.getMinutes()); });
  report();
  return { stage };
}
