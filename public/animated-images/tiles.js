import { mount, put, colors, ticked, meter } from '/paint-clocks/kit.js';

export default function start() {
  const canvas = document.getElementById('tilesCanvas');
  const out = document.getElementById('tilesOut');
  const signs = [...canvas.querySelectorAll('.sign')];
  const tiles = [...canvas.querySelectorAll('.clock')].map((clock, i) => ({
    clock, sign: signs[i], name: signs[i].querySelector('b').textContent, ticks: 0, meter: meter(),
  }));
  const svg = canvas.querySelector('svg');

  // Is the canvas on screen? The handler counts the paint events that arrive while it is not.
  let onScreen = true, leftAt = 0, away = 0;
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; leftAt = performance.now(); }).observe(canvas);

  // #region tiles
  // Each tile has one animated image (the clock) and one sign. The handler never reads the time to move
  // a sign: it counts the paint events that name the tile's clock in changedElements. The lit notch of
  // the ring goes on one place for each event, and the sign swings through one cycle in 12 events.
  // All the files hold 12 frames of 80 ms, so signs whose formats raise one event per frame stay in step.
  const TILE = 146, CLOCK = 48;
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const c = colors(canvas);
    if (!onScreen && t - leftAt > 300) away++;
    const tw = Math.min(w / 2, 230), x0 = (w - tw * 2) / 2;
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const rates = [];
    tiles.forEach((tile, i) => {
      const { clock, sign } = tile, running = clock.isConnected;
      if (running && ticked(event, clock)) { tile.ticks++; tile.meter.tick(t); }
      const cx = x0 + (i % 2 + 0.5) * tw, cy = 38 + Math.floor(i / 2) * TILE;
      // The clock is drawn at the same place every time. An element drawn at a new place raises a paint
      // event of its own, and that event would be counted as a frame of the image.
      if (running) put(ctx, clock, cx - CLOCK / 2, cy - CLOCK / 2);
      for (let n = 0; n < 12; n++) {
        const lit = running && n === tile.ticks % 12, a = n * Math.PI / 6 - Math.PI / 2;
        ctx.fillStyle = lit ? c.accent : c.line;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 32, cy + Math.sin(a) * 32, lit ? 4 : 2.2, 0, 7); ctx.fill();
      }
      const rate = running ? tile.meter.rate() : 0;
      rates.push(`${tile.name}: ${rate}`);
      ctx.fillStyle = c.muted;
      ctx.fillText(running ? `${rate}/s` : 'off', cx + 44, cy);
      // The sign hangs from the clock on two strings and swings about the clock's centre.
      const swing = Math.sin(tile.ticks * Math.PI / 6) * 0.17, W = sign.offsetWidth, top = 42;
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        const x = side * (W / 2 - 14);
        ctx.beginPath();
        ctx.moveTo(cx + side * 14, cy + CLOCK / 2);
        ctx.lineTo(cx + x * Math.cos(swing) - top * Math.sin(swing), cy + x * Math.sin(swing) + top * Math.cos(swing));
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(swing);
      put(ctx, sign, -W / 2, top);
      ctx.restore();
    });
    out.textContent = `Paint events that named each clock in the last second: ${rates.join('; ')}. Paint events in total: ${stage.count()}. `
      + `Paint events while the canvas was off screen: ${away}. requestAnimationFrame calls and timers: 0.`;
  });
  // #endregion tiles

  // The buttons only change the image elements.
  let plays = 0;
  const restart = (tile) => {
    const el = tile.clock, q = `?play=${plays}`;
    if (el.dataset.file && el.localName === 'img') el.src = el.dataset.file + q;
    else if (el.dataset.file) el.style.backgroundImage = `url(${el.dataset.file}${q})`;
    tile.ticks = 0;
  };
  document.getElementById('tilesOnce').addEventListener('click', () => { plays++; restart(tiles.find((t) => t.clock.id === 'onceClock')); });
  document.getElementById('tilesRestart').addEventListener('click', () => {
    plays++;
    for (const tile of tiles) { if (!tile.clock.isConnected) canvas.append(tile.clock); restart(tile); }
    svg.setCurrentTime(0);
    stage.request();
  });
  document.getElementById('tilesRemove').addEventListener('click', () => { for (const tile of tiles) tile.clock.remove(); stage.request(); });
  return { stage, tiles };
}
