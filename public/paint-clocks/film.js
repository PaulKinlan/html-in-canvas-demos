import { mount, put, colors, ticked, meter } from './kit.js';

export default function start() {
  const canvas = document.getElementById('filmCanvas');
  const video = document.getElementById('filmVideo');
  const cards = [...canvas.querySelectorAll('.swing')];
  const credits = document.getElementById('filmCredits');
  const out = document.getElementById('filmOut');
  const play = document.getElementById('filmPlay'), seek = document.getElementById('filmSeek');
  if (!video.src) video.src = video.dataset.src;

  const said = (time) => {
    out.textContent = video.paused
      ? `Paused at ${time.toFixed(2)} s. A paused video raises no paint events. Paint events in total: ${stage.count()}.`
      : `Playing, currentTime ${time.toFixed(2)} s. Paint events from the video in the last second: ${ticks.rate()}. Paint events in total: ${stage.count()}. requestAnimationFrame calls and timers: 0.`;
  };
  // #region film
  // The only clock is the video. Each new video frame repaints the element and raises `paint`, and the
  // handler places everything from video.currentTime. Pause the video and the scene stops on that frame.
  // Seek it and the scene jumps to the same moment.
  const ticks = meter();
  let time = 0;
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const c = colors(canvas);
    // currentTime is read only when the video itself repainted, so each video frame gives one frame of the scene.
    if (ticked(event, video)) { time = video.currentTime || 0; ticks.tick(t); }
    const length = video.duration || 10;
    const k = Math.min(1, w / 380);
    ctx.scale(k, k);
    const W = w / k;
    // The film, always at the same place, with a bar under it that is drawn from currentTime. A clock that
    // is drawn at a new place raises a second paint event, so the clock itself stays still.
    ctx.save();
    ctx.translate(W / 2 - video.offsetWidth / 2, 74 - video.offsetHeight / 2);
    put(ctx, video, 0, 0);
    ctx.fillStyle = c.line; ctx.fillRect(0, video.offsetHeight + 6, video.offsetWidth, 5);
    ctx.fillStyle = c.accent; ctx.fillRect(0, video.offsetHeight + 6, video.offsetWidth * time / length, 5);
    ctx.restore();
    // Three cards on strings. The angle of each is a function of currentTime only.
    cards.forEach((card, i) => {
      const x = W * (0.2 + i * 0.3), angle = Math.sin(time * (2.2 + i * 0.35) + i * 1.3) * 0.42;
      ctx.save();
      ctx.translate(x, 150); ctx.rotate(angle);
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 46); ctx.stroke();
      put(ctx, card, -card.offsetWidth / 2, 46);
      ctx.restore();
    });
    // Credits that roll once for each play of the film.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 262, W, 76); ctx.clip();
    put(ctx, credits, (W - credits.offsetWidth) / 2, 338 - (time / length) * (credits.offsetHeight + 76));
    ctx.restore();
    said(time);
  });
  // #endregion film

  // The controls only change the video.
  play.addEventListener('click', () => { if (video.paused) video.play().catch((e) => { out.textContent = `play() failed: ${e.message}`; }); else video.pause(); });
  video.addEventListener('play', () => { play.textContent = 'Pause'; });
  video.addEventListener('pause', () => { play.textContent = 'Play'; said(video.currentTime); });
  seek.addEventListener('input', () => { video.currentTime = (video.duration || 10) * seek.value / 100; });
  return { stage };
}
