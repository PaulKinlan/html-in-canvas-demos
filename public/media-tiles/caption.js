import { mount, put, piece, place, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('capCanvas');
  const img = document.getElementById('capImg');
  const text = document.getElementById('capText');
  const out = document.getElementById('capOut');
  let effect = 'ripple', paints = 0;

  // A dot for the halftone mask, made once on a plain canvas and used as a repeating pattern.
  const dot = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  { const d = dot.getContext('2d'); d.beginPath(); d.arc(8, 8, 6.2, 0, 7); d.fill(); }
  let dots = null;

  // #region caption
  // The <figure> is a child of the canvas and is not drawn. Its <img> and its <figcaption> each have the
  // `drawable` attribute, so each has its own picture: the image goes through the effect and the caption
  // is drawn afterwards with one plain call.
  const effects = {
    // Rows 2 px tall, each moved sideways by a sine. The rows below the shore move further.
    ripple(ctx, x, y, w, h, s) {
      const iw = img.offsetWidth, ih = img.offsetHeight, shore = 0.72;
      piece(ctx, img, 0, 0, iw, ih * shore, x, y, w, h * shore);
      const rows = Math.ceil(h * (1 - shore) / 2);
      for (let i = 0; i < rows; i++) {
        const f = i / rows, yy = y + h * shore + i * 2;
        const dx = Math.sin(s * 2.4 + i * 0.55) * (1.5 + f * 9) + Math.sin(s * 1.1 + i * 0.21) * f * 6;
        piece(ctx, img, 0, ih * shore + (i * 2) * ih / h, iw, 2.5 * ih / h, x + dx, yy, w, 2.5);
      }
    },
    // Grey through ctx.filter, then two blends that map black and white to two colours.
    duotone(ctx, x, y, w, h, s) {
      ctx.filter = 'grayscale(1) contrast(1.25)';
      put2(ctx, x, y, w, h);
      ctx.filter = 'none';
      const hue = (s * 25) % 360;
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `hsl(${hue + 40} 95% 62%)`; ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = `hsl(${hue + 230} 80% 22%)`; ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
    // The image is kept only where a grid of dots is: destination-in with a pattern whose scale moves.
    dots(ctx, x, y, w, h, s) {
      ctx.filter = 'saturate(1.5) brightness(1.15)';
      put2(ctx, x, y, w, h);
      ctx.filter = 'none';
      dots ??= ctx.createPattern(dot, 'repeat');
      const size = 0.5 + (Math.sin(s * 0.9) * 0.5 + 0.5) * 0.9;
      dots.setTransform(new DOMMatrix().translate(x + w / 2, y + h / 2).rotate(20).scale(size));
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = dots; ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
    // Upright slats, each a source rectangle squeezed about its own middle, as a blind turns.
    slats(ctx, x, y, w, h, s) {
      const iw = img.offsetWidth, ih = img.offsetHeight, n = 12, sw = w / n;
      for (let i = 0; i < n; i++) {
        const turn = Math.cos(s * 1.2 - i * 0.35), wide = Math.abs(turn) * sw;
        ctx.filter = `brightness(${0.45 + Math.abs(turn) * 0.7})`;
        if (wide > 0.5) piece(ctx, img, i * iw / n, 0, iw / n, ih, x + (i + 0.5) * sw - wide / 2, y, wide, h);
      }
      ctx.filter = 'none';
    },
  };
  const put2 = (ctx, x, y, w, h) => piece(ctx, img, 0, 0, img.offsetWidth, img.offsetHeight, x, y, w, h);

  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const iw = Math.min(w - 24, img.offsetWidth), ih = iw * img.offsetHeight / img.offsetWidth;
    const x = (w - iw) / 2, y = 12;
    // The effect is drawn on the empty canvas, so a blend or a mask touches the image only.
    effects[effect](ctx, x, y, iw, ih, t / 1000);
    // The page colour goes behind what was drawn.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = effect === 'ripple' ? c.card : '#101014'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // The effect's source rectangles moved the image's hit region. Put it back on the whole image.
    ctx.save(); ctx.translate(x, y); ctx.scale(iw / img.offsetWidth, iw / img.offsetWidth); place(ctx, img, 0, 0); ctx.restore();

    // The caption: a blurred copy of the image behind it, then the element itself, untouched.
    const cw = text.offsetWidth, ch = text.offsetHeight;
    const tx = x + 10, ty = y + ih - ch - 10;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(tx, ty, cw, ch, 8); ctx.clip();
    ctx.filter = 'blur(7px) brightness(0.55)';
    put2(ctx, x, y, iw, ih);
    ctx.filter = 'none';
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(iw / img.offsetWidth, iw / img.offsetWidth); place(ctx, img, 0, 0); ctx.restore();
    put(ctx, text, tx, ty);

    out.textContent = `Effect "${effect}" on the <img>. The <figcaption> is drawn by 1 call with no filter: ${text.textContent.trim().length} characters of text. Paint events: ${paints}.`;
    return true;   // every effect moves, so ask for the next frame while the canvas is on screen
  });
  // #endregion caption

  for (const button of document.querySelectorAll('[data-cap]')) {
    button.addEventListener('click', () => {
      effect = button.dataset.cap;
      for (const b of document.querySelectorAll('[data-cap]')) b.setAttribute('aria-pressed', String(b === button));
      stage.request();
    });
  }
  return { stage };
}
