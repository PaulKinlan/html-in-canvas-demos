import { mount, ticked, meter, put, place } from '/paint-clocks/kit.js';

export default function start() {
  const canvas = document.getElementById('tickerCanvas'), marquee = document.getElementById('tickerTape'), out = document.getElementById('tickerOut');
  const button = document.getElementById('tickerStop');
  let last = 'none yet', running = true;
  const clock = meter();
  // #region ticker
  // The <marquee> scrolls by itself, and each step of it raises `paint`. That is the only clock here:
  // no requestAnimationFrame() and no timer. The canvas draws the marquee as a board of lit dots with a
  // reflection under it. The marquee is drawn at its own size and place, so each link is under the
  // finger where it is seen, while it moves.
  let dots = null;
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    if (running && ticked(event, marquee)) clock.tick(t);
    const mw = marquee.offsetWidth, mh = marquee.offsetHeight, k = Math.min(1, (w - 24) / mw), x = (w - mw * k) / 2, y = 26;
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
    if (!dots) {
      // A 4 px cell with a hole in the middle: drawn over the text, it leaves round dots of it.
      const cell = new OffscreenCanvas(4, 4), g = cell.getContext('2d');
      g.fillStyle = '#05070b'; g.fillRect(0, 0, 4, 4);
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(2, 2, 1.75, 0, 7); g.fill();
      dots = ctx.createPattern(cell, 'repeat');
    }
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    // The reflection first: the marquee upside down under the board, faded.
    ctx.save();
    ctx.translate(0, mh * 2 + 10); ctx.scale(1, -0.7);
    ctx.globalAlpha = 0.28; ctx.filter = 'blur(1.5px)';
    put(ctx, marquee, 0, 0);
    ctx.restore();
    // The board, with a glow, then the dot mask over it.
    ctx.filter = 'blur(6px) brightness(1.6)'; ctx.globalAlpha = 0.8; put(ctx, marquee, 0, 0);
    ctx.filter = 'none'; ctx.globalAlpha = 1; put(ctx, marquee, 0, 0);
    ctx.fillStyle = dots; ctx.fillRect(-6, -6, mw + 12, mh * 2 + 30);
    ctx.strokeStyle = '#2a3140'; ctx.lineWidth = 3; ctx.strokeRect(-6, -6, mw + 12, mh + 12);
    // The last draw of the marquee was the upright one, so its hit region is the board.
    place(ctx, marquee, 0, 0);
    ctx.restore();
    out.textContent = `${running ? `Paint events from the marquee in the last second: ${clock.rate()}.` : 'Stopped with marquee.stop(): no more paint events.'} Last link tapped: ${last}. requestAnimationFrame calls and timers: 0.`;
  });
  // #endregion ticker
  marquee.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    last = `${a.textContent.trim()} (${a.getAttribute('href')})`;
    stage.request();
  });
  button.addEventListener('click', () => {
    running = !running;
    if (running) marquee.start(); else marquee.stop();
    button.textContent = running ? 'Stop the marquee' : 'Start the marquee';
    stage.request();
  });
  return { stage };
}
