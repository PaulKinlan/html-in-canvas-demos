import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('inertCanvas');
  const panels = [...canvas.querySelectorAll('.panel')];
  const useInert = document.getElementById('inertOn');
  const out = document.getElementById('inertOut');
  let current = 0;
  const place = (i, w) => ({ x: Math.round((w - panels[0].offsetWidth) / 2) - 36 + i * 36, y: 12 + i * 22 });

  // #region inert
  const stage = mount(canvas, (ctx, w) => {
    const c = colors(canvas);
    // Only the current panel is drawn. The others are outlines made by the canvas.
    panels.forEach((panel, i) => {
      const { x, y } = place(i, w);
      if (i === current) return;
      ctx.strokeStyle = c.line; ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 0.5, y + 0.5, panel.offsetWidth, panel.offsetHeight);
    });
    const { x, y } = place(current, w);
    put(ctx, panels[current], x, y);
    return false;
  });

  function apply() {
    // A panel that is not drawn keeps the hit region of its last draw and stays in the Tab order.
    // inert removes both.
    panels.forEach((panel, i) => { panel.inert = useInert.checked && i !== current; });
    stage.request();
    setTimeout(report, 80);
  }
  // #endregion inert

  function report() {
    const stops = panels.flatMap((panel, i) => (i === current || panel.inert ? [] : [...panel.querySelectorAll('input, button')]));
    const box = canvas.getBoundingClientRect();
    // A point that only a panel that is not drawn has covered: the left edge of panel 1, or the right edge of panel 3.
    const other = current === 0 ? 2 : 0, spot = place(other, box.width);
    const px = box.x + spot.x + (other === 0 ? 8 : panels[0].offsetWidth - 8), py = box.y + spot.y + (other === 0 ? 8 : panels[0].offsetHeight - 6);
    const hit = document.elementFromPoint(px, py)?.closest?.('.panel');
    const active = document.activeElement?.closest?.('.panel');
    const lost = active && panels.indexOf(active) !== current;
    out.innerHTML = `Drawn: panel ${current + 1}. Tab stops in panels that are not drawn: <b class="${stops.length ? 'fail' : 'pass'}">${stops.length}</b>. `
      + `Hit test where panel ${other + 1} was last drawn: <b class="${hit ? 'fail' : 'pass'}">${hit ? 'panel ' + (panels.indexOf(hit) + 1) + ', which is not drawn' : 'nothing'}</b>.`
      + (lost ? ` <b class="fail">Focus is in panel ${panels.indexOf(active) + 1}, which is not drawn.</b>` : '');
  }
  canvas.addEventListener('click', (e) => {
    if (!e.target.matches('button.next')) return;
    current = (current + 1) % panels.length;
    apply();
    panels[current].querySelector('input').focus({ preventScroll: true });
  });
  canvas.addEventListener('focusin', () => setTimeout(report, 50));
  useInert.addEventListener('change', apply);
  apply();
}
