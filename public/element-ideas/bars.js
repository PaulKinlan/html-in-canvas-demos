import { mount, put, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('barsCanvas');
  const table = document.getElementById('barsTable');
  const slider = document.getElementById('barsUp');
  const out = document.getElementById('barsOut');
  const rows = [...table.rows].map((tr) => [...tr.cells]);
  const sides = ['#2a9d8f', '#e9a03b', '#c8553d'];
  const value = (cell) => (cell.localName === 'td' ? clamp(parseFloat(cell.textContent) || 0, 0, 60) : 0);

  // #region bars
  const stage = mount(canvas, (ctx, w, h) => {
    const up = slider.value / 100;
    const k = Math.min(1, (w - 12) / (table.offsetWidth + 110));
    // The floor is a shear: columns stay level, rows go back and to the right.
    const floor = (rise) => {
      ctx.translate((w - table.offsetWidth * k) / 2 + table.offsetHeight * 0.25 * up * k, h - 16 - table.offsetHeight * 0.55 * k - rise);
      ctx.scale(k, k);
      ctx.transform(1, 0, -0.5 * up, 1 - 0.45 * up, 0, 0);
    };
    // Far rows first, so nearer bars cover them.
    rows.forEach((cells, r) => cells.forEach((cell) => {
      const x = cell.offsetLeft, y = cell.offsetTop, cw = cell.offsetWidth, ch = cell.offsetHeight;
      const rise = value(cell) * 2.6 * k * up;
      // The bar is a stack of the cell's outline, one for each pixel of height.
      ctx.fillStyle = sides[(r - 1) % sides.length] ?? '#888';
      for (let z = 0; z < rise; z += 1) { ctx.save(); floor(z); ctx.fillRect(x, y, cw, ch); ctx.restore(); }
      // The cell itself is drawn on top of its bar. Its hit region goes there too, so a tap on the top edits the number.
      ctx.save(); floor(rise); put(ctx, cell, x, y); ctx.restore();
    }));
    return false;
  });
  // #endregion bars

  const report = () => {
    const sum = rows.flat().reduce((n, cell) => n + value(cell), 0);
    out.textContent = `Total of the table: ${sum}`;
    stage.request();
  };
  table.addEventListener('input', report);
  slider.addEventListener('input', stage.request);
  report();
}
