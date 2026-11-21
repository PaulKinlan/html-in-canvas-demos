import { mount, put, colors, clamp, smooth } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('galleryCanvas'), out = document.getElementById('galleryOut');
  const prints = [...canvas.querySelectorAll('figure')];
  let picked = -1, t0 = -1e9;
  const rest = (i) => { const o = i - (prints.length - 1) / 2; return { x: o * 48, y: 36 + Math.abs(o) * 12, r: o * 0.17, s: 0.92 }; };
  let from = prints.map((_, i) => rest(i)), now = from.map((p) => ({ ...p }));
  // #region gallery
  // Each print is a <figure> with an <img> and a <figcaption>. They are drawn fanned out, each turned
  // about its own middle. A tap on one draws it last, straight and larger, and the canvas writes the
  // alt attribute of its image under it.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = smooth(clamp((t - t0) / 380)), pw = prints[0].offsetWidth, ph = prints[0].offsetHeight;
    const fit = Math.min(1, (w - 20) / (pw * 1.2));
    const to = (i) => (i === picked ? { x: 0, y: 14, r: 0, s: 1.2 } : rest(i));
    now = prints.map((_, i) => { const a = from[i], b = to(i); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, r: a.r + (b.r - a.r) * u, s: a.s + (b.s - a.s) * u }; });
    const order = [...prints.keys()].filter((i) => i !== picked);
    if (picked >= 0) order.push(picked);
    for (const i of order) {
      const p = now[i];
      ctx.save();
      ctx.translate(w / 2 + p.x * fit, p.y + ph * p.s * fit / 2); ctx.rotate(p.r); ctx.scale(p.s * fit, p.s * fit);
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
      put(ctx, prints[i], -pw / 2, -ph / 2);
      ctx.restore();
    }
    if (picked >= 0) {
      // The alt text, wrapped to the width of the canvas.
      const words = `alt: ${prints[picked].querySelector('img').alt}`.split(' '), lines = [''];
      ctx.font = '14px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (const word of words) { const next = lines.at(-1) ? `${lines.at(-1)} ${word}` : word; if (ctx.measureText(next).width > w - 32 && lines.at(-1)) lines.push(word); else lines[lines.length - 1] = next; }
      ctx.globalAlpha = u; ctx.fillStyle = c.fg;
      lines.forEach((line, n) => ctx.fillText(line, w / 2, 14 + ph * 1.2 * fit + 16 + n * 19));
      ctx.globalAlpha = 1;
    }
    out.textContent = picked >= 0 ? `Picked: ${prints[picked].querySelector('figcaption').textContent.trim()}. Its img has alt text of ${prints[picked].querySelector('img').alt.length} characters.` : `${prints.length} prints. Tap one.`;
    return u < 1;
  });
  canvas.addEventListener('click', (e) => {
    const figure = e.target.closest('figure');
    from = now.map((p) => ({ ...p }));
    picked = figure ? (prints.indexOf(figure) === picked ? -1 : prints.indexOf(figure)) : -1;
    t0 = performance.now(); stage.request();
  });
  // #endregion gallery
  return { stage };
}
