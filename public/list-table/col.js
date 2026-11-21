// Column highlight from <col>, for /list-table/.
// The table is drawn whole. The <col> elements are never drawn: their boxes say where each column is.
import { mount, put, colors, clamp } from '/lib/stage-2d.js';
import { rgba, isDark } from './kit.js';

export default function start() {
  const canvas = document.getElementById('colCanvas');
  const table = document.getElementById('colTable');
  const cols = [...table.querySelectorAll('col')];
  const heads = [...table.tHead.rows[0].cells];
  const out = document.getElementById('colOut');
  const mode = document.getElementById('colMode');
  let lit = 3;                      // index of the column that has the light
  let beam = null;                  // { left, right, y }: where the light is drawn now, eased toward the column
  let pointerY = null;

  // #region col-pick
  // A <col> has no picture, but it has a box. Its offsetLeft is measured from the table, and the table's
  // from #colWrap (position: relative), which sits at the canvas origin.
  const boxOf = (col) => ({ left: table.offsetLeft + col.offsetLeft, width: col.offsetWidth });
  function columnAt(clientX) {
    const x = clientX - canvas.getBoundingClientRect().left - canvas.clientLeft;
    return cols.findIndex((col) => { const b = boxOf(col); return x >= b.left && x < b.left + b.width; });
  }
  function light(index, y = null) {
    pointerY = y;
    if (index < 0 || index === lit) { stage.request(); return; }
    lit = index;
    // The flat fill is a class on the <col>. Its background is part of the table's picture.
    cols.forEach((col, i) => col.classList.toggle('lit', mode.value !== 'light' && i === lit));
    stage.request();
  }
  canvas.addEventListener('pointermove', (e) => light(columnAt(e.clientX), e.clientY - canvas.getBoundingClientRect().top));
  canvas.addEventListener('pointerdown', (e) => light(columnAt(e.clientX), e.clientY - canvas.getBoundingClientRect().top));
  canvas.addEventListener('pointerleave', () => light(lit));
  heads.forEach((th, i) => th.querySelector('button').addEventListener('focus', () => light(i)));
  // #endregion col-pick

  mode.addEventListener('change', () => { cols.forEach((col, i) => col.classList.toggle('lit', mode.value !== 'light' && i === lit)); stage.request(); });

  // #region col-paint
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), dark = isDark(c.bg);
    const tx = table.offsetLeft, ty = table.offsetTop;     // the table's place in layout, from #colWrap
    const tw = table.offsetWidth, th = table.offsetHeight;
    if (!put(ctx, table, tx, ty, tw, th)) return false;

    // Ease the light toward the box of the lit <col>.
    const b = boxOf(cols[lit]);
    const want = { left: b.left, right: b.left + b.width, y: pointerY ?? ty + th / 2 };
    if (!beam) beam = { ...want };
    let moving = false;
    for (const k of ['left', 'right', 'y']) {
      const d = want[k] - beam[k];
      if (Math.abs(d) > 0.4) { beam[k] += d * 0.22; moving = true; } else beam[k] = want[k];
    }
    out.textContent = `Column ${lit + 1} of ${cols.length} (${heads[lit].textContent.trim()}). col.offsetLeft ${Math.round(b.left - tx)}, col.offsetWidth ${b.width}. drawElementImage(col) would throw.`;
    if (mode.value === 'flat') return moving;

    const mid = (beam.left + beam.right) / 2, half = (beam.right - beam.left) / 2, feather = 16;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 8);
    ctx.clip();
    // 1. Shade the other columns. The gradient is clear over the lit column and has soft edges.
    const stop = (x) => clamp((x - tx) / tw);
    const shade = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    const deep = rgba('#000000', dark ? 0.5 : 0.2);
    shade.addColorStop(0, deep);
    shade.addColorStop(stop(beam.left - feather), deep);
    shade.addColorStop(stop(beam.left + 2), 'rgba(0,0,0,0)');
    shade.addColorStop(stop(beam.right - 2), 'rgba(0,0,0,0)');
    shade.addColorStop(stop(beam.right + feather), deep);
    shade.addColorStop(1, deep);
    ctx.fillStyle = shade;
    ctx.fillRect(tx, ty, tw, th);
    // 2. The light: an ellipse of the accent colour centred on the pointer, as tall as the table.
    ctx.translate(mid, beam.y);
    ctx.scale((half + feather) / 100, 1);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
    glow.addColorStop(0, rgba(c.accent, dark ? 0.5 : 0.34));
    glow.addColorStop(0.55, rgba(c.accent, dark ? 0.2 : 0.14));
    glow.addColorStop(1, rgba(c.accent, 0));
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
    ctx.fillStyle = glow;
    ctx.scale(1, Math.max(1, th * 0.75 / 100));
    ctx.fillRect(-100, -100, 200, 200);
    ctx.restore();
    // 3. A bright line at each edge of the column, strongest at the height of the pointer.
    for (const x of [beam.left, beam.right]) {
      const edge = ctx.createLinearGradient(0, beam.y - th * 0.6, 0, beam.y + th * 0.6);
      edge.addColorStop(0, rgba(c.accent, 0)); edge.addColorStop(0.5, rgba(c.accent, 0.9)); edge.addColorStop(1, rgba(c.accent, 0));
      ctx.fillStyle = edge;
      ctx.fillRect(x - 1, Math.max(ty, beam.y - th * 0.6), 2, Math.min(th, th * 1.2));
    }
    return moving;
  });
  // #endregion col-paint
  window.__listTable = { ...(window.__listTable ?? {}), col: { canvas, table, cols, get lit() { return lit; } } };
}
