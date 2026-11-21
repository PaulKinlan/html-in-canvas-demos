import { mount, put, place, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('inkCanvas');
  const text = document.getElementById('inkText');
  const out = document.getElementById('inkOut');

  // #region ink
  // There is no listener on the textarea. A key press changes its picture, the browser raises `paint`,
  // and the paint handler compares the length of the value with the length it saw last time.
  let seenLength = text.value.length, seen = 0, paints = 0;
  const blots = [];
  const caretOf = (i) => {
    // The box of character i, relative to the textarea. Both boxes are at the drawn position.
    const field = text.getBoundingClientRect();
    const r = text.createValueRange?.(i, i + 1).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return { x: field.width / 2, y: field.height / 2 };
    const k = text.offsetWidth / field.width || 1;
    return { x: (r.left + r.width / 2 - field.left) * k, y: (r.top + r.height / 2 - field.top) * k };
  };

  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const length = text.value.length;
    if (length > seenLength && text.selectionStart > 0) {
      seen += length - seenLength;
      blots.push({ ...caretOf(text.selectionStart - 1), born: t });
      if (blots.length > 4) blots.shift();
    }
    seenLength = length;
    while (blots.length && t - blots[0].born > 1400) blots.shift();

    const k = Math.min(1, (w - 16) / text.offsetWidth);
    const x0 = (w - text.offsetWidth * k) / 2, y0 = (h - text.offsetHeight * k) / 2;
    ctx.translate(x0, y0); ctx.scale(k, k);
    put(ctx, text, 0, 0);
    for (const blot of blots) {
      const age = clamp((t - blot.born) / 1400), wet = (1 - age) ** 2;
      // Wet ink: the textarea is drawn again, blurred and slightly enlarged, inside a circle at the new letter.
      ctx.save();
      ctx.beginPath(); ctx.arc(blot.x, blot.y, 26, 0, 7); ctx.clip();
      ctx.filter = `blur(${(wet * 5).toFixed(2)}px)`;
      ctx.translate(blot.x, blot.y); ctx.scale(1 + wet * 0.3, 1 + wet * 0.3); ctx.translate(-blot.x, -blot.y);
      put(ctx, text, 0, 0);
      ctx.restore();
      // A stain that spreads and dries, multiplied into the paper and the letters.
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const r = 8 + age * 30, stain = ctx.createRadialGradient(blot.x, blot.y, 0, blot.x, blot.y, r);
      stain.addColorStop(0, `rgb(27 42 110 / ${(1 - age) * 0.5})`); stain.addColorStop(1, 'rgb(27 42 110 / 0)');
      ctx.fillStyle = stain; ctx.beginPath(); ctx.arc(blot.x, blot.y, r, 0, 7); ctx.fill();
      ctx.restore();
    }
    // The enlarged draws moved the hit region. One draw that is clipped away puts it back.
    if (blots.length) place(ctx, text, 0, 0);
    out.textContent = `Listeners on the textarea: 0. Characters the paint handler saw arrive: ${seen}. Paint events: ${paints}.`;
    return blots.length > 0;
  });
  // #endregion ink
  return { stage };
}
