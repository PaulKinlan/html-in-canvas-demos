import { mount, put, park, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('flowCanvas');
  const list = document.getElementById('flowList');
  const items = [...list.children];
  const out = document.getElementById('flowOut');
  let pos = 2, target = 2, dragging = false, startX = 0, startTarget = 0, moved = 0;

  // #region flow
  const stage = mount(canvas, (ctx, w, h) => {
    pos += (target - pos) * (dragging ? 0.5 : 0.16);
    const size = items[0].offsetWidth, cx = w / 2, cy = 16 + size / 2;
    const order = items.map((li, i) => ({ li, d: i - pos })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const { li, d } of order) {
      if (Math.abs(d) > 3.4) { park(canvas, li); continue; }
      const side = clamp(d, -1, 1), turn = Math.abs(side);
      const x = cx + side * (size * 0.62) + (d - side) * (size * 0.26);
      // A turned cover is narrower and sheared. Each <li> is drawn on its own, so each keeps its own hit region.
      const shape = () => { ctx.translate(x, cy); ctx.transform(1 - 0.58 * turn, -0.2 * side, 0, 1 - 0.12 * turn, 0, 0); };
      ctx.save(); shape();
      ctx.translate(0, size + 6); ctx.scale(1, -1);
      ctx.globalAlpha = 0.16; put(ctx, li, -size / 2, -size / 2 - size);
      ctx.restore();
      ctx.save(); shape();
      ctx.filter = `brightness(${1 - 0.4 * turn})`;
      put(ctx, li, -size / 2, -size / 2);
      ctx.restore();
    }
    return dragging || Math.abs(target - pos) > 0.002;
  });
  // #endregion flow

  const go = (i) => { target = clamp(Math.round(i), 0, items.length - 1); stage.request(); };
  canvas.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; startTarget = target; moved = 0; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || (e.pointerType === 'mouse' && !e.buttons)) return;
    moved = Math.max(moved, Math.abs(e.clientX - startX));
    if (moved > 8) { target = clamp(startTarget - (e.clientX - startX) / 90, 0, items.length - 1); stage.request(); }
  });
  const release = () => { if (dragging) { dragging = false; go(target); } };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // A tap on a cover at the side brings it to the front. A tap on the front cover reaches its button.
  list.addEventListener('click', (e) => {
    const i = items.indexOf(e.target.closest('li'));
    if (moved > 8) { e.preventDefault(); e.stopPropagation(); return; }
    if (i !== Math.round(target)) { e.preventDefault(); e.stopPropagation(); go(i); return; }
    if (e.target.closest('button')) out.textContent = 'Playing: ' + items[i].querySelector('h3').textContent;
  }, true);
  list.addEventListener('focusin', (e) => go(items.indexOf(e.target.closest('li'))));
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    go(target + step);
    items[Math.round(target)].querySelector('button').focus({ preventScroll: true });
  });
}
