import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('tvCanvas');
  const video = document.getElementById('tvVideo');

  // #region tv
  mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const W = video.offsetWidth, H = video.offsetHeight;
    const x0 = Math.round((w - W) / 2), y0 = 34;
    // One sheared plane for everything, so the screen looks turned a little to the side.
    const plane = () => { ctx.translate(x0, y0 + 12); ctx.transform(0.96, -0.07, 0, 1, 0, 0); };
    // Light from the screen on the wall: the video, larger and blurred.
    ctx.save();
    plane();
    ctx.translate(W / 2, H / 2); ctx.scale(1.12, 1.18); ctx.translate(-W / 2, -H / 2);
    ctx.filter = 'blur(26px) saturate(1.8)'; ctx.globalAlpha = 0.8;
    put(ctx, video, 0, 0);
    ctx.restore();
    // Reflection on the shelf: the video upside down, faded out below.
    ctx.save();
    plane();
    ctx.translate(0, 2 * H + 22); ctx.scale(1, -1);
    ctx.globalAlpha = 0.28;
    put(ctx, video, 0, 0);
    ctx.restore();
    const fade = ctx.createLinearGradient(0, y0 + H + 16, 0, y0 + H + 90);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, c.bg);
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = fade; ctx.fillRect(0, y0 + H, w, h); ctx.restore();
    ctx.fillStyle = c.bg; ctx.fillRect(0, y0 + H + 90, w, h);
    // The set, then the video itself. This draw is the last one, so the controls take taps here.
    ctx.save();
    plane();
    ctx.fillStyle = '#16140f'; ctx.beginPath(); ctx.roundRect(-9, -9, W + 18, H + 18, 10); ctx.fill();
    ctx.fillStyle = '#16140f'; ctx.fillRect(W / 2 - 40, H + 9, 80, 7);
    put(ctx, video, 0, 0);
    ctx.restore();
    return false;
  });
  // #endregion tv
}
