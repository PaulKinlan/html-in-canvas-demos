import { mount, put, colors } from '/form-state/kit.js';
import { fx } from './fx.js';

export default function start() {
  const section = document.getElementById('states');
  const canvas = document.getElementById('statesCanvas');
  const card = document.getElementById('statesCard');
  const out = document.getElementById('statesOut');
  const saved = document.getElementById('statesSaved');
  card.addEventListener('submit', (e) => { e.preventDefault(); saved.textContent = 'Saved.'; });
  card.addEventListener('input', () => { saved.textContent = ''; });

  // #region states
  // Nothing here listens to the checkbox, the <details>, the field or the popover. Four CSS rules on the
  // section turn their states into numbers on the canvas, and this handler reads the numbers.
  let uniforms;
  const stage = mount(canvas, (ctx, w, h) => {
    const { amount, progress, x, y } = uniforms.read(), c = colors(canvas);
    const cw = card.offsetWidth, ch = card.offsetHeight, cx = w / 2, top = 66;
    // --fx-amount, from :checked. A lamp over the card: its light, and the brightness of the card.
    ctx.fillStyle = '#0d1017'; ctx.fillRect(0, 0, w, h);
    const cone = ctx.createRadialGradient(cx, 30, 4, cx, 30, h * 0.95);
    cone.addColorStop(0, `rgb(255 214 150 / ${0.85 * amount})`); cone.addColorStop(1, 'rgb(255 214 150 / 0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(cx - 14, 30); ctx.lineTo(cx + 14, 30); ctx.lineTo(cx + w * 0.62, h); ctx.lineTo(cx - w * 0.62, h); ctx.fill();
    ctx.fillStyle = '#3a3f4b'; ctx.fillRect(cx - 1.5, 0, 3, 18);
    ctx.beginPath(); ctx.moveTo(cx - 22, 32); ctx.lineTo(cx - 10, 14); ctx.lineTo(cx + 10, 14); ctx.lineTo(cx + 22, 32); ctx.fill();
    ctx.fillStyle = `rgb(255 ${180 + 60 * amount} ${90 + 120 * amount} / ${0.25 + 0.75 * amount})`;
    ctx.beginPath(); ctx.ellipse(cx, 33, 18, 5, 0, 0, 7); ctx.fill();
    ctx.save();
    // --fx-x, from :user-invalid. The card shakes while the number moves from 0 to 1.
    ctx.translate(cx + Math.sin(x * Math.PI * 7) * 14 * (1 - x), top);
    // --fx-progress, from details:open. The card tips and its shadow grows.
    ctx.rotate(-0.045 * progress);
    // --fx-y, from :popover-open on an element outside the canvas. The card steps back and blurs.
    ctx.scale(1 - 0.1 * y, 1 - 0.1 * y);
    ctx.shadowColor = 'rgb(0 0 0 / 0.6)'; ctx.shadowBlur = 10 + 26 * progress; ctx.shadowOffsetY = 4 + 14 * progress;
    ctx.fillStyle = c.card; ctx.beginPath(); ctx.roundRect(-cw / 2, 0, cw, ch, 12); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.filter = `brightness(${0.42 + 0.58 * amount}) blur(${2.5 * y}px)`;
    put(ctx, card, -cw / 2, 0);
    ctx.filter = 'none';
    if (x > 0.01) { ctx.strokeStyle = c.bad; ctx.globalAlpha = x; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(-cw / 2 - 3, -3, cw + 6, ch + 6, 14); ctx.stroke(); }
    ctx.restore();
    const on = (selector) => (section.querySelector(selector) ? 'matches' : 'no match');
    out.textContent = `:checked ${on('#statesLamp:checked')}, --fx-amount ${amount.toFixed(2)}. details:open ${on('details:open')}, --fx-progress ${progress.toFixed(2)}. `
      + `:user-invalid ${on(':user-invalid')}, --fx-x ${x.toFixed(2)}. :popover-open ${on(':popover-open')}, --fx-y ${y.toFixed(2)}.`;
    return uniforms.moving;
  });
  uniforms = fx(canvas, stage.request);
  // #endregion states
  return { stage };
}
