import { mount, put, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('svgCanvas');
  const box = document.getElementById('svgBox');
  const out = document.getElementById('svgOut');
  const tiltInput = document.getElementById('svgTilt');
  const bars = [...box.querySelectorAll('a.bar')];
  let turn = 0, turnTo = 0, last = 0, paints = 0, hovers = 0, lastHover = null, drag = null, dragged = false, over = false, picked = null, hash = location.hash;

  // #region svg
  // The chart is an inline <svg> in one drawable <div>. The canvas draws it under the affine transform of
  // a sheet seen from above and to one side (a turn in the plane, then a tilt away from the viewer). The
  // same transform places the hit region, so :hover, focus and the links on the bars follow the tilt.
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    // The sheet sways by itself until a pointer is over it. A drag turns it.
    if (!drag && !over) turnTo = Math.sin(t / 1900) * 0.5;
    turn += (turnTo - turn) * (1 - Math.exp(-dt * 8));
    const tilt = Number(tiltInput.value) * Math.PI / 180;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    const k = Math.min(1, (w - 16) / (bw * 1.12));
    const cos = Math.cos(turn), sin = Math.sin(turn), squash = Math.cos(tilt);
    const sheet = (lift) => {
      // x' = cos·x − sin·y, y' = (sin·x + cos·y)·cos(tilt): an orthographic view, which is affine.
      ctx.translate(w / 2, h * 0.52 + lift);
      ctx.transform(cos * k, sin * squash * k, -sin * k, cos * squash * k, 0, 0);
      ctx.translate(-bw / 2, -bh / 2);
    };
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
    // Shadow on the table, then the thickness of the sheet as darker copies, then the chart.
    const thick = Math.round(4 + Math.sin(tilt) * 12);
    ctx.save(); sheet(thick + 16); ctx.filter = 'blur(10px)'; ctx.fillStyle = '#0005'; ctx.fillRect(0, 0, bw, bh); ctx.restore();
    ctx.save(); sheet(thick); ctx.fillStyle = '#5b5f6e'; ctx.beginPath(); ctx.roundRect(0, 0, bw, bh, 14); ctx.fill(); ctx.restore();
    for (let i = thick - 1; i > 0; i -= 2) { ctx.save(); sheet(i); ctx.fillStyle = i % 4 < 2 ? '#8a8fa0' : '#7c8192'; ctx.beginPath(); ctx.roundRect(0, 0, bw, bh, 14); ctx.fill(); ctx.restore(); }
    ctx.save(); sheet(0); put(ctx, box, 0, 0); ctx.restore();

    // The state is read from the chart in the paint handler: which bar matches :hover or has focus.
    const hot = box.querySelector('a.bar:hover') ?? box.querySelector('a.bar:focus-visible') ?? picked;
    if (hot !== lastHover) { if (hot && hot.matches(':hover')) hovers++; lastHover = hot; }
    if (hot) {
      // getBoundingClientRect() of a shape inside the drawn chart is its box at the drawn place.
      const r = hot.querySelector('rect').getBoundingClientRect(), cb = canvas.getBoundingClientRect();
      const tx = clamp(r.left + r.width / 2 - cb.left, 62, w - 62), ty = Math.max(30, r.top - cb.top - 10);
      const label = `${hot.dataset.name}: ${hot.dataset.value}`;
      ctx.font = '600 13px system-ui, sans-serif';
      const lw = ctx.measureText(label).width + 18;
      ctx.fillStyle = '#111d'; ctx.beginPath(); ctx.roundRect(tx - lw / 2, ty - 24, lw, 24, 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx - 6, ty); ctx.lineTo(tx + 6, ty); ctx.lineTo(tx, ty + 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, tx, ty - 12);
    }
    out.textContent = `Turn ${Math.round(turn * 180 / Math.PI) || 0}°, tilt ${tiltInput.value}°. Bars seen through :hover in the paint handler: ${hovers}. `
      + `location.hash after a tap on a bar: ${hash || 'none yet'}. Paint events: ${paints}.`;
    return true;   // the line in the chart is animated by CSS, and the sheet sways
  });
  // #endregion svg

  // #region svg-touch
  // A touch has no hover. A tap follows the bar's link, which is an ordinary <a href="#bar=…"> in the SVG.
  // The page reads the result from location.hash and keeps the label on that bar.
  const fromHash = () => {
    hash = location.hash;
    const name = hash.startsWith('#bar=') ? hash.slice(5) : null;
    picked = bars.find((a) => a.dataset.key === name) ?? null;
    for (const a of bars) a.classList.toggle('on', a === picked);
    stage.request();
  };
  addEventListener('hashchange', fromHash);
  if (location.hash.startsWith('#bar=')) fromHash();
  // #endregion svg-touch

  // A sideways drag turns the sheet. An upright drag is left to the browser, which scrolls the page.
  canvas.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') over = true; });
  canvas.addEventListener('pointerleave', () => { over = false; });
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, turn: turnTo, moved: false }; dragged = false; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) turnTo = clamp(drag.turn + dx / 160, -1.1, 1.1);
  });
  const end = () => { dragged = !!drag?.moved; drag = null; };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
  // A drag that turned the sheet must not also follow the link under the finger.
  canvas.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); dragged = false; } }, true);
  tiltInput.addEventListener('input', () => stage.request());

  // New values: each bar's height is a CSS transform with a transition, so the browser animates the
  // change and raises `paint` for each frame of it.
  const setData = () => {
    for (const a of bars) {
      const v = 15 + Math.round(Math.random() * 85);
      a.dataset.value = v;
      a.style.setProperty('--v', v / 100);
      a.querySelector('text').textContent = v;
    }
  };
  document.getElementById('svgData').addEventListener('click', setData);
  return { stage };
}

