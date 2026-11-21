import { mount, put, hitOnly } from './kit.js';

export default function start() {
  const canvas = document.getElementById('crtCanvas');
  const text = document.getElementById('crtText');

  // #region crt
  mount(canvas, (ctx, w, h, t) => {
    const W = text.offsetWidth, H = text.offsetHeight;
    const x0 = Math.round((w - W) / 2), y0 = Math.round((h - H) / 2);
    ctx.fillStyle = '#2a2622'; ctx.beginPath(); ctx.roundRect(x0 - 18, y0 - 18, W + 36, H + 36, 22); ctx.fill();
    ctx.fillStyle = '#021a0c'; ctx.beginPath(); ctx.roundRect(x0 - 6, y0 - 6, W + 12, H + 12, 16); ctx.fill();
    ctx.save();
    ctx.clip();
    // Bulge: the textarea is drawn in 24 bands, each a little wider towards the middle of the screen.
    const bands = 24;
    for (let i = 0; i < bands; i++) {
      const y = i * H / bands, mid = ((i + 0.5) / bands) * 2 - 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0 - 6, y0 + y, W + 12, H / bands + 0.5); ctx.clip();
      ctx.translate(x0 + W / 2, 0);
      ctx.scale(1.02 - 0.05 * mid * mid, 1);
      put(ctx, text, -W / 2, y0);
      ctx.restore();
    }
    // Phosphor glow: the same picture again, blurred and added.
    ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(3px)'; ctx.globalAlpha = 0.55;
    put(ctx, text, x0, y0);
    ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    // Scan lines, a bright band that rolls down, and darker corners.
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (let y = y0 - 6; y < y0 + H + 6; y += 3) ctx.fillRect(x0 - 6, y, W + 12, 1);
    const roll = y0 - 40 + ((t / 30) % (H + 80));
    const band = ctx.createLinearGradient(0, roll - 30, 0, roll + 30);
    band.addColorStop(0, 'rgba(160, 255, 190, 0)'); band.addColorStop(0.5, 'rgba(160, 255, 190, 0.07)'); band.addColorStop(1, 'rgba(160, 255, 190, 0)');
    ctx.fillStyle = band; ctx.fillRect(x0 - 6, roll - 30, W + 12, 60);
    const shade = ctx.createRadialGradient(x0 + W / 2, y0 + H / 2, H * 0.35, x0 + W / 2, y0 + H / 2, W * 0.75);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)'); shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = shade; ctx.fillRect(x0 - 6, y0 - 6, W + 12, H + 12);
    ctx.restore();
    // Last, an invisible flat draw. It puts the hit region and the caret mapping on the unbent rectangle.
    hitOnly(ctx, text, x0, y0);
    return true;
  });
  // #endregion crt
}
