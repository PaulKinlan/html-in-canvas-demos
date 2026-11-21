import { mount, put, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('tipCanvas');
  const text = document.getElementById('tipText');
  const tip = document.getElementById('tip');
  const out = document.getElementById('tipOut');

  // #region tooltip-read
  // Each title is moved to data-tip, so the browser's own tooltip, which is painted outside the canvas
  // and only for a mouse, does not appear as well. The term points at the drawn tooltip for a screen reader.
  for (const el of text.querySelectorAll('[title]')) {
    el.dataset.tip = el.title;
    el.removeAttribute('title');
    el.setAttribute('aria-describedby', 'tip');
    if (el.tabIndex < 0) el.tabIndex = 0;
  }
  let active = null, shown = 0, last = 0;
  const show = (el) => {
    if (el === active) return;
    active = el;
    if (el) tip.textContent = el.dataset.tip;
    out.textContent = el ? `Tooltip for "${el.textContent}": ${el.dataset.tip}` : 'No tooltip. Point at, tap or tab to an underlined term.';
    stage.request();
  };
  const term = (e) => e.target.closest?.('[data-tip]');
  text.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') show(term(e)); });
  text.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && !document.activeElement?.dataset?.tip) show(null); });
  text.addEventListener('click', (e) => show(term(e) === active && e.detail ? active : term(e)));
  text.addEventListener('focusin', (e) => show(term(e)));
  text.addEventListener('focusout', () => show(null));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') show(null); });
  addEventListener('pointerdown', (e) => { if (active && !text.contains(e.target)) show(null); });
  // #endregion tooltip-read

  // #region tooltip
  const TILT = -0.035;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const want = active ? 1 : 0;
    shown += (want - shown) * (1 - Math.exp(-dt * 14));
    const moving = Math.abs(want - shown) > 0.004;
    if (!moving) shown = want;

    const k = Math.min(1, (w - 28) / text.offsetWidth);
    const base = () => { ctx.translate(w / 2, 150); ctx.rotate(TILT); ctx.scale(k, k); ctx.translate(-text.offsetWidth / 2, -text.offsetHeight / 2); };
    ctx.save(); base(); put(ctx, text, 0, 0); ctx.restore();
    if (!active && shown < 0.01) return false;
    if (active) {
      // Where the term was drawn. The text is tilted, so its boxes come from the browser, in window
      // coordinates, and are moved into the coordinates of the canvas.
      const origin = canvas.getBoundingClientRect();
      const boxes = [...active.getClientRects()].map((r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }));
      if (!boxes.length) return moving;
      const b = boxes[0], cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      // The term, drawn again larger inside a rounded box, and marked.
      for (const r of boxes) {
        const grow = 1 + 0.28 * shown, rx = r.x + r.w / 2, ry = r.y + r.h / 2;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(rx - (r.w / 2 + 5) * grow, ry - (r.h / 2 + 3) * grow, (r.w + 10) * grow, (r.h + 6) * grow, 6); ctx.clip();
        ctx.fillStyle = c.card; ctx.fillRect(0, 0, w, h);
        ctx.translate(rx, ry); ctx.scale(grow, grow); ctx.translate(-rx, -ry);
        base(); put(ctx, text, 0, 0);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(255 214 64 / ${0.55 * shown})`;
        ctx.beginPath(); ctx.roundRect(rx - (r.w / 2 + 5) * grow, ry - (r.h / 2 + 3) * grow, (r.w + 10) * grow, (r.h + 6) * grow, 6); ctx.fill();
        ctx.restore();
      }
      // Input goes to the text at its first, unscaled place.
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); base(); put(ctx, text, 0, 0); ctx.restore();
      // The tooltip: a real element, drawn above the term or below it when there is no room, with a tail.
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const above = b.y - th - 22 > 4;
      const x = clamp(cx - tw / 2, 8, w - tw - 8), y = above ? b.y - th - 18 : b.y + b.h + 18;
      const s = 0.7 + 0.3 * shown, px = clamp(cx, x + 14, x + tw - 14), py = above ? y + th : y;
      ctx.save();
      ctx.globalAlpha = shown;
      ctx.translate(px, py); ctx.scale(s, s); ctx.translate(-px, -py);
      ctx.fillStyle = '#1d2330';
      ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.lineTo(px, py + (above ? 10 : -10)); ctx.closePath(); ctx.fill();
      put(ctx, tip, x, y);
      ctx.restore();
      void cy;
    }
    return moving;
  });
  // #endregion tooltip
  return { stage };
}
