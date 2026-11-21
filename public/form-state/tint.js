import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('tintCanvas');
  const input = document.getElementById('tintInput');
  const card = document.getElementById('tintCard');
  const out = document.getElementById('tintOut');
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  // #region tint
  // The colour input is the lamp. Its value is read in the paint handler. Choosing a colour repaints the
  // swatch, which raises `paint`, so there is no input or change listener.
  let shown = parse(input.value), last = 0, paints = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const want = parse(input.value);
    shown = shown.map((v, i) => v + (want[i] - v) * (1 - Math.exp(-dt * 6)));
    const moving = shown.some((v, i) => Math.abs(v - want[i]) > 0.6);
    if (!moving) shown = want;
    const rgb = shown.map(Math.round).join(' ');
    const k = Math.min(1, w / 380), lampX = 62 * k, lampY = 64 * k;

    // The wall and the card, in their own colours.
    ctx.fillStyle = '#d9d6cf'; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w - (card.offsetWidth + 22) * k, h - (card.offsetHeight + 24) * k); ctx.scale(k, k);
    put(ctx, card, 0, 0);
    ctx.restore();
    // The light: everything drawn so far is multiplied by the colour, strongest far from the lamp,
    // then a glow in the same colour is added round the lamp.
    ctx.globalCompositeOperation = 'multiply';
    const shade = ctx.createRadialGradient(lampX, lampY, 20 * k, lampX, lampY, Math.hypot(w, h));
    shade.addColorStop(0, `rgb(${rgb} / 0.15)`); shade.addColorStop(0.5, `rgb(${rgb} / 0.8)`); shade.addColorStop(1, `rgb(${shown.map((v) => Math.round(v * 0.35)).join(' ')})`);
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, 150 * k);
    glow.addColorStop(0, `rgb(${rgb} / 0.9)`); glow.addColorStop(1, `rgb(${rgb} / 0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // The flex and the fitting, then the input itself as the bulb, drawn last so the light does not tint it.
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3 * k;
    ctx.beginPath(); ctx.moveTo(lampX, 0); ctx.lineTo(lampX, lampY - 30 * k); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.roundRect(lampX - 14 * k, lampY - 40 * k, 28 * k, 16 * k, 4 * k); ctx.fill();
    ctx.save();
    ctx.translate(lampX - input.offsetWidth * k / 2, lampY - input.offsetHeight * k / 2); ctx.scale(k, k);
    put(ctx, input, 0, 0);
    ctx.restore();
    out.textContent = `input.value ${input.value}, read in the paint handler. Input and change listeners: 0. Paint events: ${paints}.`;
    return moving;
  });
  // #endregion tint

  // The preset buttons only write the value. They do not ask the canvas to repaint.
  for (const button of document.querySelectorAll('[data-tint]')) button.addEventListener('click', () => { input.value = button.dataset.tint; });
  return { stage };
}
