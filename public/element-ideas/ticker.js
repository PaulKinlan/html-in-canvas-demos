import { mount, put } from './kit.js';

export default function start() {
  const canvas = document.getElementById('tickerCanvas');
  const marquee = document.getElementById('tickerText');
  const input = document.getElementById('tickerInput');
  const pause = document.getElementById('tickerPause');
  let dots = null, dotsKey = '';

  // A tile with one round hole, repeated over the panel.
  function pattern(ctx, pitch, dpr) {
    const key = pitch + ':' + dpr;
    if (key === dotsKey) return dots;
    const size = Math.round(pitch * dpr);
    const tile = new OffscreenCanvas(size, size), g = tile.getContext('2d');
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.36, 0, 7); g.fill();
    dots = ctx.createPattern(tile, 'repeat');
    dots.setTransform(new DOMMatrix().scale(pitch / size));
    dotsKey = key;
    return dots;
  }

  // #region ticker
  mount(canvas, (ctx, w, h) => {
    const dpr = canvas.width / canvas.clientWidth || 1;
    const W = marquee.offsetWidth, H = marquee.offsetHeight;
    const scale = (w - 24) / W, pitch = Math.max(3, Math.round(scale * 1.7));
    const x0 = 12, ph = Math.floor(H * scale / pitch) * pitch, y0 = Math.round((h - ph) / 2);
    const draw = () => { ctx.save(); ctx.translate(x0, y0); ctx.scale(scale, scale); put(ctx, marquee, 0, 0); ctx.restore(); };
    ctx.beginPath(); ctx.rect(x0, y0, Math.floor((w - 24) / pitch) * pitch, ph); ctx.clip();
    ctx.translate(x0, y0);
    const holes = pattern(ctx, pitch, dpr);
    ctx.translate(-x0, -y0);
    // The marquee, enlarged. The browser moves its text; each move fires `paint`.
    draw();
    // Keep only the parts of the picture that fall on a dot.
    ctx.save(); ctx.translate(x0, y0); ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = holes; ctx.fillRect(0, 0, w, h); ctx.restore();
    // Behind them, unlit dots and the black panel.
    ctx.save(); ctx.translate(x0, y0); ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 0.16; ctx.fillStyle = '#ffb000'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1; ctx.fillStyle = holes; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 1; ctx.fillStyle = '#0b0a08'; ctx.fillRect(0, 0, w, h);
    ctx.restore();
    // Glow. This is also the last draw, so the link in the marquee takes taps where it is shown.
    ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(3px)'; ctx.globalAlpha = 0.5;
    draw();
    return false;
  });
  // #endregion ticker

  input.addEventListener('input', () => { marquee.querySelector('span').textContent = input.value; });
  pause.addEventListener('click', () => {
    const stopped = pause.getAttribute('aria-pressed') === 'true';
    if (stopped) marquee.start(); else marquee.stop();
    pause.setAttribute('aria-pressed', !stopped);
    pause.textContent = stopped ? 'Pause' : 'Resume';
  });
}
