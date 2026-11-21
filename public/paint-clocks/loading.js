import { mount, put, ticked, meter } from './kit.js';

export default function start() {
  const canvas = document.getElementById('loadCanvas');
  const bar = document.getElementById('loadBar');
  const card = document.getElementById('loadCard');
  const out = document.getElementById('loadOut');

  // #region loading
  // The only clock is the progress bar. While it has no value it repaints (its stripes move), and each
  // repaint raises `paint`. The handler draws the card as 14 strips that sway, grey and blurred, under a
  // moving band of light. When the bar gets a value it repaints once more and then stops, so the last
  // frame drawn is the finished card and nothing runs after it.
  const STRIPS = 14, ticks = meter();
  let at = 0;
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const loading = bar.position < 0;
    // The time moves on only when the bar itself repainted. Any other paint event redraws the same frame.
    if (ticked(event, bar)) { at = t; ticks.tick(t); }
    const W = card.offsetWidth, H = card.offsetHeight;
    const k = Math.min(1, (w - 24) / W);
    ctx.translate((w - W * k) / 2, 14); ctx.scale(k, k);
    put(ctx, bar, 0, 0);
    ctx.translate(0, bar.offsetHeight + 14);
    if (!loading) {
      put(ctx, card, 0, 0);
    } else {
      const time = at / 1000, sh = H / STRIPS;
      ctx.filter = 'grayscale(1) blur(2px)';
      for (let i = 0; i < STRIPS; i++) {
        const sway = Math.sin(time * 3.1 + i * 0.55) * 9 + Math.sin(time * 1.3 + i * 1.7) * 4;
        ctx.save();
        ctx.beginPath(); ctx.rect(-20, i * sh, W + 40, sh + 0.5); ctx.clip();
        put(ctx, card, sway, 0);
        ctx.restore();
      }
      ctx.filter = 'none';
      // A band of light that crosses the card, kept inside the pixels the strips painted.
      ctx.globalCompositeOperation = 'source-atop';
      const x = ((time * 0.7) % 1) * (W + 240) - 120, band = ctx.createLinearGradient(x - 90, 0, x + 90, 0);
      band.addColorStop(0, 'rgb(255 255 255 / 0)'); band.addColorStop(0.5, 'rgb(255 255 255 / 0.75)'); band.addColorStop(1, 'rgb(255 255 255 / 0)');
      ctx.fillStyle = band; ctx.fillRect(-20, 0, W + 40, H);
      ctx.globalCompositeOperation = 'source-over';
      // The flat card is where input goes.
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); put(ctx, card, 0, 0); ctx.restore();
    }
    out.textContent = loading
      ? `Loading. Paint events from the bar in the last second: ${ticks.rate()}. Paint events in total: ${stage.count()}. requestAnimationFrame calls and timers: 0.`
      : `Loaded. The bar has a value, so it raises no more paint events. Paint events in total: ${stage.count()}.`;
  });
  // #endregion loading

  // The buttons only change the element.
  document.getElementById('loadStart').addEventListener('click', () => bar.removeAttribute('value'));
  document.getElementById('loadFinish').addEventListener('click', () => { bar.value = 100; });
  return { stage };
}
