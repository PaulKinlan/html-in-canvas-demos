import { mount, put, colors, clamp, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('diffCanvas');
  const text = document.getElementById('diffText');
  const slider = document.getElementById('diffAt');
  const play = document.getElementById('diffPlay');
  let at = 0;

  // Boxes of the lines of some elements, relative to the article.
  const boxes = (selector) => {
    const o = text.getBoundingClientRect();
    return [...text.querySelectorAll(selector)].flatMap((el) => [...el.getClientRects()]).map((r) => ({ x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }));
  };

  // #region diff
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const x0 = Math.round((w - text.offsetWidth) / 2), y0 = 14;
    const old = at < 0.5, u = old ? at / 0.5 : (at - 0.5) / 0.5;
    const parts = boxes(old ? 'del' : 'ins');
    // Everything except the changed words: clip them out and draw the article once.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    for (const b of parts) ctx.rect(x0 + b.x, y0 + b.y, b.w, b.h);
    ctx.clip('evenodd');
    put(ctx, text, x0, y0);
    ctx.restore();
    const total = parts.reduce((n, b) => n + b.w, 0);
    let done = 0;
    for (const b of parts) {
      // How far the line (first half) or the wipe (second half) has got through this box.
      const reach = clamp((clamp(u / 0.65) * total - done) / b.w);
      done += b.w;
      ctx.save();
      ctx.beginPath();
      if (old) {
        ctx.rect(x0 + b.x, y0 + b.y, b.w, b.h); ctx.clip();
        ctx.globalAlpha = 1 - clamp((u - 0.65) / 0.35);
        put(ctx, text, x0, y0);
        ctx.strokeStyle = c.bad; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0 + b.x, y0 + b.y + b.h * 0.55); ctx.lineTo(x0 + b.x + b.w * reach, y0 + b.y + b.h * 0.55); ctx.stroke();
      } else {
        ctx.rect(x0 + b.x, y0 + b.y, b.w * reach, b.h); ctx.clip();
        put(ctx, text, x0, y0);
        if (reach > 0 && reach < 1) { ctx.fillStyle = c.ok; ctx.fillRect(x0 + b.x + b.w * reach - 2, y0 + b.y, 2, b.h); }
      }
      ctx.restore();
    }
    return false;
  });
  // #endregion diff

  function set(value) {
    at = value;
    // Before the half-way point the article shows the old words, after it the new ones.
    text.classList.toggle('new', at >= 0.5);
    slider.value = Math.round(at * 1000);
    stage.request();
  }
  slider.addEventListener('input', () => set(slider.value / 1000));
  let cancel = null;
  play.addEventListener('click', () => { cancel?.(); cancel = tween(2600, set); });
  set(0);
}
