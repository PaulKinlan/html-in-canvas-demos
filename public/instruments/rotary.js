import { mount, put, hitOnly, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('rotaryCanvas');
  const form = document.getElementById('rotaryForm');
  const grip = document.getElementById('rotaryGrip');
  const out = document.getElementById('rotaryOut');
  const labels = [...form.querySelectorAll('label')];
  const radios = labels.map((label) => label.control);

  // #region rotary
  const SWEEP = 240 * Math.PI / 180;
  const detent = (i) => -SWEEP / 2 + SWEEP * i / (radios.length - 1);
  const checked = () => Math.max(0, radios.findIndex((r) => r.checked));
  let angle = detent(checked()), speed = 0, held = null, last = 0;
  let geo = { cx: 0, cy: 0, k: 1 };

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const k = Math.min(1, w / 380), cx = w / 2, cy = h / 2 + 14 * k;
    geo = { cx, cy, k };
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    // The knob is a spring pulled towards the angle of the checked radio. A drag holds it instead.
    const target = held ?? detent(checked());
    if (held != null) { angle = held; speed = 0; } else { speed += ((target - angle) * 190 - speed * 15) * dt; angle += speed * dt; }
    const moving = held != null || Math.abs(target - angle) > 0.002 || Math.abs(speed) > 0.02;
    if (!moving) { angle = target; speed = 0; }

    // Track, and one lamp per position. Lamps up to the knob's angle are lit.
    ctx.lineWidth = 3 * k; ctx.strokeStyle = c.line;
    ctx.beginPath(); ctx.arc(cx, cy, 80 * k, -Math.PI / 2 - SWEEP / 2, -Math.PI / 2 + SWEEP / 2); ctx.stroke();
    radios.forEach((radio, i) => {
      const a = detent(i), lit = a <= angle + 0.04;
      ctx.beginPath(); ctx.arc(cx + Math.sin(a) * 80 * k, cy - Math.cos(a) * 80 * k, 5 * k, 0, 7);
      ctx.fillStyle = lit ? c.accent : c.line;
      ctx.shadowColor = c.accent; ctx.shadowBlur = lit ? 12 * k : 0;
      ctx.fill(); ctx.shadowBlur = 0;
    });

    // The knob.
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(angle);
    const body = ctx.createRadialGradient(-18 * k, -22 * k, 4 * k, 0, 0, 62 * k);
    body.addColorStop(0, '#6b7280'); body.addColorStop(1, '#1f2430');
    ctx.fillStyle = body; ctx.shadowColor = '#0008'; ctx.shadowBlur = 14 * k; ctx.shadowOffsetY = 4 * k;
    ctx.beginPath(); ctx.arc(0, 0, 62 * k, 0, 7); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 2 * k;
    for (let n = 0; n < 28; n++) { const a = n / 28 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.sin(a) * 54 * k, -Math.cos(a) * 54 * k); ctx.lineTo(Math.sin(a) * 61 * k, -Math.cos(a) * 61 * k); ctx.stroke(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * k; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -22 * k); ctx.lineTo(0, -52 * k); ctx.stroke();
    ctx.restore();

    // Each label, with its radio inside, is drawn at its position round the dial and leaning with it.
    // drawElementImage() puts the hit region there too, so a tap on a drawn label checks its radio.
    labels.forEach((label, i) => {
      const a = detent(i);
      ctx.save();
      ctx.translate(cx + Math.sin(a) * 124 * k, cy - Math.cos(a) * 124 * k);
      ctx.rotate(a * 0.3); ctx.scale(k, k);
      put(ctx, label, -label.offsetWidth / 2, -label.offsetHeight / 2);
      ctx.restore();
    });
    // An invisible element over the knob takes the drag. It carries touch-action: none, the canvas does not.
    ctx.save(); ctx.translate(cx - 62 * k, cy - 62 * k); ctx.scale(k, k); hitOnly(ctx, grip); ctx.restore();
    return moving;
  });
  // #endregion rotary

  // #region rotary-drag
  // Turning the knob checks the radio of the nearest position. The radio group is the state. The knob has none.
  const pointerAngle = (e) => { const b = canvas.getBoundingClientRect(); return Math.atan2(e.clientX - b.left - geo.cx, -(e.clientY - b.top - geo.cy)); };
  let before = 0;
  grip.addEventListener('pointerdown', (e) => { grip.setPointerCapture(e.pointerId); before = pointerAngle(e); held = angle; stage.request(); });
  grip.addEventListener('pointermove', (e) => {
    if (held == null) return;
    const now = pointerAngle(e);
    let d = now - before; before = now;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    held = clamp(held + d, -SWEEP / 2, SWEEP / 2);
    const radio = radios[Math.round((held + SWEEP / 2) / SWEEP * (radios.length - 1))];
    if (!radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      navigator.vibrate?.(8);
    }
    stage.request();
  });
  const release = () => { held = null; stage.request(); };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);
  // #endregion rotary-drag

  const report = () => { out.textContent = `Form value: speed=${new FormData(form).get('speed')}`; stage.request(); };
  form.addEventListener('change', report);
  report();
  return { stage, detent, radios };
}
