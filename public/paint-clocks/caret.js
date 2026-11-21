import { mount, put, colors, ticked, meter } from './kit.js';

export default function start() {
  const canvas = document.getElementById('caretCanvas');
  const field = document.getElementById('caretField');
  const card = document.getElementById('caretCard');
  const out = document.getElementById('caretOut');

  // #region caret
  // The only clock is the caret. A focused field repaints each time its caret goes on or off, and each
  // repaint raises `paint`. Every paint event is one half of a beat: the card is drawn large on one and
  // at rest on the next, and one sample is added to the trace. A typed letter repaints the field as well,
  // so typing adds beats.
  let beat = false, last = 0, gap = 0;
  const ticks = meter();
  const trace = new Array(46).fill(0);
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const c = colors(canvas);
    const focused = field.matches(':focus');
    // Only a paint event raised by the field is a beat. Drawing the card at a new size raises a second
    // paint event one frame later, which names the card and redraws the same frame. The field is its own
    // drawable element and is always drawn at the same place, so it is named only when it repaints.
    if (ticked(event, field)) {
      if (focused) {
        beat = !beat;
        if (last) gap = t - last;
        last = t;
        ticks.tick(t);
        trace.push(beat ? 1 : -0.35);
      } else {
        beat = false; last = 0;
        trace.push(0);
      }
      trace.shift();
    }

    const W = card.offsetWidth, H = card.offsetHeight;
    const k = Math.min(1, (w - 40) / W), cx = w / 2, cy = 20 + H * k / 2, s = beat ? 1.06 : 1;
    // The ring drawn behind the card on the strong half of the beat.
    if (beat) {
      ctx.strokeStyle = c.bad; ctx.globalAlpha = 0.35; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.roundRect(cx - W * k * 0.56, cy - H * k * 0.6, W * k * 1.12, H * k * 1.2, 22); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k * s, k * s); ctx.translate(-W / 2, -H / 2);
    put(ctx, card, 0, 0);
    if (beat) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgb(255 60 60 / 0.12)'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    // The field, at the same place and size on every paint.
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2);
    put(ctx, field, 16, 48);
    ctx.restore();
    // The trace: one step to the left for each paint event.
    const top = 20 + H * k + 26, mid = top + 34, step = (w - 32) / (trace.length - 1);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(16, mid); ctx.lineTo(w - 16, mid); ctx.stroke();
    ctx.strokeStyle = c.bad; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
    trace.forEach((v, i) => { const x = 16 + i * step; if (i) { ctx.lineTo(x - step * 0.5, mid); ctx.lineTo(x - step * 0.25, mid - v * 30); ctx.lineTo(x, mid); } else ctx.moveTo(x, mid); });
    ctx.stroke();
    out.textContent = focused
      ? `Focused. Time since the field's last paint event: ${gap ? Math.round(gap) + ' ms' : 'first'}. Paint events from the field in the last second: ${ticks.rate()}. Paint events in total: ${stage.count()}. requestAnimationFrame calls and timers: 0.`
      : `Not focused: no caret, so no paint events. Paint events in total: ${stage.count()}. Tap the field.`;
  });
  // #endregion caret
  return { stage };
}
