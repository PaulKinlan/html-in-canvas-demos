import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('gaugeCanvas');
  const meter = document.getElementById('gaugeMeter');
  const slider = document.getElementById('gaugeValue');
  const optimum = document.getElementById('gaugeOptimum');
  const live = document.getElementById('gaugeLive');
  const out = document.getElementById('gaugeOut');

  // The region names of the HTML specification: the bar is "optimum", "suboptimal" or "even less good".
  const region = () => {
    const { value, low, high, optimum: best } = meter;
    const at = (v) => (v < low ? 0 : v > high ? 2 : 1);
    return ['in the optimum region', 'one region away from the optimum', 'two regions away from the optimum'][Math.abs(at(value) - at(best))];
  };

  // #region gauge
  const SWEEP = 240 * Math.PI / 180, SLICES = 100;
  const angleOf = (v) => -SWEEP / 2 + SWEEP * (v - meter.min) / (meter.max - meter.min);
  let needle = angleOf(meter.value), speed = 0, last = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const k = Math.min(1, w / 380), cx = w / 2, cy = h * 0.56, R = 118 * k;
    const mw = meter.offsetWidth, mh = meter.offsetHeight;

    // The arc is the meter's own picture. It is cut into 100 slices and each slice is drawn turned to its
    // angle, so the bar, its track and the colour the browser chose for the value all bend with it.
    const stretch = (R - mh * k / 2) * SWEEP / mw;
    for (let i = 0; i < SLICES; i++) {
      const x = mw * i / SLICES, dx = mw / SLICES;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-SWEEP / 2 + SWEEP * (i + 0.5) / SLICES);
      ctx.translate(0, -R);
      ctx.scale(stretch, k);
      ctx.translate(-x - dx / 2, 0);
      ctx.beginPath(); ctx.rect(x - 0.15, 0, dx + 0.3, mh); ctx.clip();
      put(ctx, meter, 0, 0);
      ctx.restore();
    }

    // Ticks at min, low, high and max, read from the element's attributes.
    ctx.font = `${12 * k}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [v, name] of [[meter.min, 'min'], [meter.low, 'low'], [meter.high, 'high'], [meter.max, 'max']]) {
      const a = angleOf(v), sin = Math.sin(a), cos = -Math.cos(a);
      ctx.strokeStyle = c.fg; ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.moveTo(cx + sin * (R + 3 * k), cy + cos * (R + 3 * k)); ctx.lineTo(cx + sin * (R + 11 * k), cy + cos * (R + 11 * k)); ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(`${name} ${v}`, cx + sin * (R + 36 * k), cy + cos * (R + 24 * k));
    }
    // A green mark inside the arc at the optimum.
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angleOf(meter.optimum));
    ctx.fillStyle = c.ok; ctx.beginPath(); ctx.moveTo(0, -(R - mh * k - 3 * k)); ctx.lineTo(-6 * k, -(R - mh * k - 14 * k)); ctx.lineTo(6 * k, -(R - mh * k - 14 * k)); ctx.closePath(); ctx.fill();
    ctx.restore();

    // The needle is a spring pulled to the meter's value.
    const target = angleOf(meter.value);
    speed += ((target - needle) * 120 - speed * 9) * dt; needle += speed * dt;
    const moving = Math.abs(target - needle) > 0.002 || Math.abs(speed) > 0.02;
    if (!moving) { needle = target; speed = 0; }
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(needle);
    ctx.fillStyle = c.fg; ctx.shadowColor = '#0006'; ctx.shadowBlur = 6 * k; ctx.shadowOffsetY = 2 * k;
    ctx.beginPath(); ctx.moveTo(-5 * k, 0); ctx.lineTo(0, -(R - mh * k - 10 * k)); ctx.lineTo(5 * k, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 10 * k, 0, 7); ctx.fill();
    ctx.restore();

    ctx.fillStyle = c.fg; ctx.font = `600 ${30 * k}px system-ui`;
    ctx.fillText(String(Math.round(meter.value)), cx, cy + 46 * k);
    // The same element drawn once more, flat, under the dial.
    ctx.save(); ctx.translate(cx - mw * k * 0.3, h - mh * k * 0.6 - 10); ctx.scale(k * 0.6, k * 0.6); put(ctx, meter, 0, 0); ctx.restore();
    return moving || live.checked;
  });
  // #endregion gauge

  const report = () => { out.textContent = `meter.value ${Math.round(meter.value)}, optimum ${meter.optimum}: ${region()}.`; stage.request(); };
  slider.addEventListener('input', () => { meter.value = slider.value; report(); });
  optimum.addEventListener('change', () => { meter.optimum = optimum.value; report(); });
  let drift = 0, tick = 0;
  live.addEventListener('change', () => {
    clearInterval(tick);
    if (live.checked) tick = setInterval(() => {
      drift = drift * 0.9 + (Math.random() - 0.5) * 9;
      meter.value = Math.min(100, Math.max(0, meter.value + drift));
      slider.value = meter.value;
      report();
    }, 250);
    stage.request();
  });
  report();
  return { stage };
}
