import { mount, put, park, clamp } from '/form-state/kit.js';
import { fx } from './fx.js';
import './media-bar.js';

export default function start() {
  const canvas = document.getElementById('barCanvas');
  const video = document.getElementById('barVideo');
  const bar = document.getElementById('barControls');
  const out = document.getElementById('barOut');
  const lift = document.getElementById('barLift');
  if (!video.src) video.src = video.dataset.src;
  video.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });

  // #region bar
  // --fx-amount is 0 while the film is paused and 1 while it plays. The only thing that sets it is the
  // CSS rule  #barCanvas:has(media-bar:state(playing)) { --fx-amount: 1 }  with a 0.35 s transition.
  let uniforms;
  const stage = mount(canvas, (ctx, w, h) => {
    const { amount } = uniforms.read();
    const vw = video.offsetWidth, vh = video.offsetHeight, k = Math.max(w / vw, h / vh);
    const frame = () => { ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(k, k); put(ctx, video, -vw / 2, -vh / 2); ctx.restore(); };
    // The film fills the canvas. Paused, it is grey and dark.
    ctx.filter = `grayscale(${1 - amount}) brightness(${0.45 + 0.55 * amount})`;
    frame();
    ctx.filter = 'none';
    const glass = (x, y, bw, bh, r) => {
      // The film again, blurred, inside the box of a control, with a dark tint: frosted glass.
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, bw, bh, r); ctx.clip();
      ctx.filter = `blur(10px) grayscale(${1 - amount}) brightness(${0.4 + 0.4 * amount})`;
      frame();
      ctx.filter = 'none';
      ctx.fillStyle = 'rgb(10 14 22 / 0.45)'; ctx.fillRect(x, y, bw, bh);
      ctx.restore();
    };
    if (!lift.checked) {
      // One picture: the whole element, as its own layout made it.
      const bw = bar.offsetWidth, bh = bar.offsetHeight, s = Math.min(1, (w - 16) / bw), x = (w - bw * s) / 2, y = h - bh * s - 8;
      glass(x, y, bw * s, bh * s, 14);
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); put(ctx, bar, 0, 0); ctx.restore();
    } else {
      // Four pictures: each part is drawable, and the canvas decides where each goes and how large.
      // The element's own layout is not used. Input goes to each part at the place it is drawn.
      const { play, timeline, time, mute } = bar.parts;
      const at = (part, x, y, s) => {
        glass(x - 6, y - 4, part.offsetWidth * s + 12, part.offsetHeight * s + 8, (part.offsetHeight * s + 8) / 2);
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s); put(ctx, part, 0, 0); ctx.restore();
      };
      const big = 2.2 - 1.1 * amount;
      at(play, (w - play.offsetWidth * big) / 2, (h - play.offsetHeight * big) / 2 - 10, big);
      at(mute, 14, 12, 1);
      at(time, w - time.offsetWidth - 16, 12, 1);
      const tw = w - 40, ts = tw / timeline.offsetWidth;
      glass(14, h - 52, w - 28, 44, 22);
      ctx.save(); ctx.translate(20, h - 50); ctx.scale(ts, 1); put(ctx, timeline, 0, 0); ctx.restore();
      park(canvas, bar);
    }
    out.textContent = `media-bar:state(playing) ${bar.matches(':state(playing)')}, :state(muted) ${bar.matches(':state(muted)')}. --fx-amount on the canvas: ${amount.toFixed(2)}. `
      + (lift.checked ? 'Drawn as four pictures, one for each part.' : 'Drawn as one picture.');
    return uniforms.moving;
  });
  uniforms = fx(canvas, stage.request);
  // #endregion bar
  lift.addEventListener('change', () => { bar.toggleAttribute('lift', lift.checked); stage.request(); });
  video.addEventListener('pause', () => stage.request());
  return { stage };
}
