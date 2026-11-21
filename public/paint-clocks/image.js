import { mount, put, colors, ticked, meter } from './kit.js';

export default function start() {
  const canvas = document.getElementById('imageCanvas');
  const flag = document.getElementById('imageFlag');
  const out = document.getElementById('imageOut');
  let img = document.getElementById('imageClock');

  // #region image
  // The only clock is an animated GIF. Each frame of the image repaints the element and raises `paint`.
  // The handler counts paint events and does not read the time, so the speed of the wave is the frame
  // rate of the image file: the 240 ms image moves it at a third of the speed of the 80 ms image.
  const SLICES = 44;
  const clock = meter();
  let ticks = 0;
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const c = colors(canvas);
    // One step for each paint event that the image raised. Other paint events redraw the same frame.
    const running = img.isConnected;
    if (running && ticked(event, img)) { ticks++; clock.tick(t); }
    const W = flag.offsetWidth, H = flag.offsetHeight;
    const k = Math.min(1, (w - 110) / W);
    if (img.isConnected) put(ctx, img, 12, 12);
    // The pole, then the card as 44 vertical slices. Each slice is moved by a wave that grows away from the pole.
    const x0 = 96, y0 = 40;
    ctx.fillStyle = c.muted; ctx.fillRect(x0 - 8, 18, 5, h - 30);
    ctx.translate(x0, y0); ctx.scale(k, k);
    const sw = W / SLICES, phase = ticks * 0.42;
    for (let i = 0; i < SLICES; i++) {
      const far = i / SLICES, y = Math.sin(phase - i * 0.24) * 16 * far, slope = Math.cos(phase - i * 0.24) * far;
      ctx.save();
      ctx.beginPath(); ctx.rect(i * sw - 0.3, y - 2, sw + 0.6, H + 4); ctx.clip();
      put(ctx, flag, 0, y);
      // Light and shade from the slope of the wave, inside the slice only.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = slope > 0 ? `rgb(0 0 0 / ${Math.min(0.3, slope * 0.3)})` : `rgb(255 255 255 / ${Math.min(0.3, -slope * 0.3)})`;
      ctx.fillRect(i * sw - 0.3, y - 2, sw + 0.6, H + 4);
      ctx.restore();
    }
    // The flat card is where input goes.
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); put(ctx, flag, 0, 0); ctx.restore();
    out.textContent = !running
      ? `Image removed. It raises no more paint events. Paint events in total: ${stage.count()}.`
      : `Image: ${img.dataset.name}${img.style.opacity === '0' ? ', with opacity: 0' : ''}. Paint events from the image in the last second: ${clock.rate()}. Paint events in total: ${stage.count()}. requestAnimationFrame calls and timers: 0.`;
  });
  // #endregion image

  // The buttons only change the image element.
  for (const button of document.querySelectorAll('[data-clock]')) button.addEventListener('click', () => {
    if (!img.isConnected) canvas.prepend(img);
    img.dataset.name = button.textContent;
    img.src = button.dataset.clock;
  });
  document.getElementById('imageRemove').addEventListener('click', () => { img.remove(); });
  document.getElementById('imageHide').addEventListener('change', (e) => { img.style.opacity = e.target.checked ? '0' : ''; });
  return { stage };
}
