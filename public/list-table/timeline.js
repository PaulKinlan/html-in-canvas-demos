// Timeline from an ordered list, for /list-table/.
// Every <li> is laid out at the same place. The canvas draws each one at a point on a path, turned to the
// path's direction. The number on a card is the li's own inside marker.
import { mount, put, park, colors, clamp } from '/lib/stage-2d.js';
import { rgba } from './kit.js';

export default function start() {
  const canvas = document.getElementById('timeCanvas');
  const ol = document.getElementById('timeline');
  const items = [...ol.children];
  const out = document.getElementById('timeOut');
  const pathKind = document.getElementById('timePath');
  const GAP = 178;                    // px of drag for one item
  let pos = 3, target = 3;            // the item at the middle of the path. pos eases toward target.
  let drag = null, dragged = false, settled = false, last = 0;

  // #region time-path
  // The point and direction of the path at s items from the middle. s = 0 is the middle of the canvas.
  function pathAt(s, w, kind) {
    if (kind === 'wave') {
      const y = 34 * Math.sin(s * 1.5), slope = (34 * 1.5 * Math.cos(s * 1.5)) / GAP;
      return { x: w / 2 + s * GAP, y: 150 + y, angle: Math.atan(slope) };
    }
    const R = 420, a = s * 0.44;      // an arch: a circle whose centre is far below the canvas
    return { x: w / 2 + R * Math.sin(a), y: 132 + R * (1 - Math.cos(a)), angle: a };
  }
  // #endregion time-path

  function go(index) {
    target = clamp(Math.round(index), 0, items.length - 1);
    settled = false;
    stage.request();
  }

  // #region time-paint
  const stage = mount(canvas, (ctx, w, h, now) => {
    const c = colors(canvas), kind = pathKind.value;
    // Ease toward the target unless a finger holds the list.
    const dt = Math.min(64, now - last || 16); last = now;
    if (!drag?.moved) {
      const d = target - pos;
      pos = Math.abs(d) < 0.003 ? target : pos + d * (1 - Math.exp(-dt / 110));
    }
    const moving = pos !== target || !!drag?.moved;

    // The line, 70 px outside the cards, from the first item to the last.
    const lineAt = (s) => { const p = pathAt(s, w, kind); return { x: p.x + 70 * Math.sin(p.angle), y: p.y - 70 * Math.cos(p.angle) }; };
    const stroke = (from, to, colour, width) => {
      ctx.beginPath();
      for (let s = from; s <= to + 0.001; s += 0.05) { const p = lineAt(s); ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
    };
    stroke(-pos, items.length - 1 - pos, c.line, 4);
    stroke(-pos, 0, c.accent, 4);                       // the part that is behind the middle item

    // Items far from the middle first, the middle one last so it is on top and takes the taps.
    const order = items.map((li, i) => ({ li, i, s: i - pos })).sort((a, b) => Math.abs(b.s) - Math.abs(a.s));
    for (const { li, i, s } of order) {
      const dot = lineAt(s), p = pathAt(s, w, kind);
      const near = clamp(1 - Math.abs(s));              // 1 at the middle, 0 one item away
      ctx.beginPath(); ctx.moveTo(dot.x, dot.y); ctx.lineTo(p.x + 52 * Math.sin(p.angle), p.y - 52 * Math.cos(p.angle));
      ctx.strokeStyle = s <= 0.01 ? c.accent : c.line; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(dot.x, dot.y, 5 + 3 * near, 0, 7);
      ctx.fillStyle = s <= 0.01 ? c.accent : c.card; ctx.fill();
      ctx.strokeStyle = s <= 0.01 ? c.accent : c.line; ctx.stroke();
      const lw = li.offsetWidth, lh = li.offsetHeight, scale = 0.78 + 0.22 * near;
      if (Math.abs(s) > 3.2 || p.x < -lw || p.x > w + lw) { park(canvas, li); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * 0.8);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.72 + 0.28 * near;
      if (near > 0) { ctx.shadowColor = rgba('#000000', 0.3 * near); ctx.shadowBlur = 22 * near; ctx.shadowOffsetY = 10 * near; }
      put(ctx, li, -lw / 2, -lh / 2, lw, lh);
      ctx.restore();
    }
    if (!moving && !settled) { settled = true; for (const li of items) li.toggleAttribute('data-settled'); }   // clears the remembered hit test
    const mid = items[clamp(Math.round(pos), 0, items.length - 1)];
    out.textContent = `Item ${Math.round(pos) + 1} of ${items.length}: ${mid.querySelector('time').textContent} ${mid.querySelector('b').textContent}. Marker numbers are drawn by the browser${ol.reversed ? ', counting down (reversed)' : ''}.`;
    return moving;
  });
  // #endregion time-paint

  // #region time-drag
  // touch-action: pan-y on the canvas leaves vertical swipes to the page and gives sideways ones to these handlers.
  canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, from: pos, moved: false }; dragged = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 8) return;
    if (!drag.moved) { drag.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch {} }
    pos = clamp(drag.from - dx / GAP, -0.4, items.length - 0.6);
    settled = false;
    stage.request();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    dragged = drag.moved;
    drag = null;
    if (dragged) go(pos);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // A tap on an item brings it to the middle. The click that ends a drag is ignored.
  ol.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li && !dragged) go(items.indexOf(li)); dragged = false; });
  // #endregion time-drag

  // Keyboard: Tab or the arrow keys move the focus from item to item, and the focused item comes to the middle.
  ol.addEventListener('focusin', (e) => { const li = e.target.closest('li'); if (li) go(items.indexOf(li)); });
  ol.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const i = items.indexOf(e.target.closest('li'));
    if (!step || i < 0) return;
    e.preventDefault();
    items[clamp(i + step, 0, items.length - 1)].focus({ preventScroll: true });
  });
  document.getElementById('timePrev').addEventListener('click', () => go(target - 1));
  document.getElementById('timeNext').addEventListener('click', () => go(target + 1));
  pathKind.addEventListener('change', () => { settled = false; stage.request(); });
  document.getElementById('timeReversed').addEventListener('change', (e) => { ol.reversed = e.target.checked; });
  window.__listTable = { ...(window.__listTable ?? {}), timeline: { canvas, ol, get pos() { return pos; }, go } };
}
