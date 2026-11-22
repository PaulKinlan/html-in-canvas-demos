import { mount, put, colors } from '/form-state/kit.js';
import { route } from './probe.js';

export default function start() {
  const canvas = document.getElementById('permitCanvas'), inside = document.getElementById('permIn'), over = document.getElementById('permOver');
  const out = document.getElementById('permitOut'), move = document.getElementById('permMove'), tilt = document.getElementById('permTilt');
  const has = 'HTMLGeolocationElement' in window;
  let log = 'No prompt yet.', spin = -1e9, changes = 0;
  // #region permit
  // Two permission buttons. One is a drawable child of the canvas and is drawn with
  // drawElementImage(), flat and at full size. The other is outside the canvas, positioned over it,
  // and the canvas draws the scene round the place where it lies. The browser says whether it would
  // accept a tap on each (isValid, invalidReason), and the canvas draws a ring from that answer:
  // no pixel is read.
  const say = (el) => (!has ? 'no geolocation element here' : el.isValid ? 'isValid: true' : `isValid: false (${el.invalidReason || 'no reason given'})`);
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), cr = canvas.getBoundingClientRect();
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    const dock = (y, label, el, r) => {
      const good = has && el.isValid;
      ctx.fillStyle = c.muted; ctx.fillText(label, 16, y);
      ctx.strokeStyle = good ? c.ok : c.bad; ctx.lineWidth = 3; ctx.setLineDash(good ? [] : [7, 5]);
      ctx.beginPath(); ctx.roundRect(r.x - 8, r.y - 8, r.w + 16, r.h + 16, 12); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = good ? c.ok : c.bad; ctx.font = '600 13px system-ui, sans-serif'; ctx.fillText(say(el), 16, r.y + r.h + 30, w - 24); ctx.font = '12px system-ui, sans-serif';
    };
    put(ctx, inside, 24, 44);
    dock(24, 'Inside the canvas, drawn by drawElementImage()', inside, { x: 24, y: 44, w: inside.offsetWidth, h: inside.offsetHeight });
    const o = over.getBoundingClientRect();
    dock(168, 'Outside the canvas, laid over it', over, { x: o.left - cr.left, y: o.top - cr.top, w: o.width, h: o.height });
    // A compass that turns when a position arrives.
    const s = Math.max(0, 1 - (t - spin) / 1600), cx = w - 56, cy = 214;
    ctx.strokeStyle = c.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, 7); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5 + s * s * 14);
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(7, 0); ctx.lineTo(-7, 0); ctx.fill();
    ctx.fillStyle = c.muted; ctx.beginPath(); ctx.moveTo(0, 28); ctx.lineTo(7, 0); ctx.lineTo(-7, 0); ctx.fill();
    ctx.restore();
    out.textContent = `${has ? 'This browser has the geolocation element.' : 'This browser has no geolocation element: both are unknown elements.'} Changes of validity so far: ${changes}. ${log}`;
    return s > 0;
  });
  for (const el of [inside, over]) el.addEventListener('validationstatuschange', () => { changes++; stage.request(); });
  over.addEventListener('promptaction', () => { log = 'The prompt was answered.'; stage.request(); });
  over.addEventListener('promptdismiss', () => { log = 'The prompt was dismissed.'; stage.request(); });
  over.addEventListener('location', () => {
    // Only the accuracy is shown. The position is not stored or sent anywhere.
    log = over.position ? `A position arrived, accurate to ${Math.round(over.position.coords.accuracy)} m.` : `No position: ${over.error?.message ?? 'unknown error'}.`;
    spin = performance.now(); route('permitR2', log, over.position ? 'works' : 'unknown'); stage.request();
  });
  move.addEventListener('click', () => { over.classList.toggle('moved'); stage.request(); setTimeout(() => stage.request(), 60); });
  tilt.addEventListener('change', () => { over.classList.toggle('tilted', tilt.checked); stage.request(); setTimeout(() => stage.request(), 60); });
  // The overlay goes back into the flow if the canvas is replaced by plain HTML.
  addEventListener('form-state-plain', () => { over.style.position = 'static'; });
  // The routes need no tap: the browser reports them, and they are written again when its answer changes.
  const routes = () => {
    route('permitR1', has ? `${say(inside)}.` : 'No geolocation element in this browser.', has && inside.isValid ? 'works' : has ? 'blocked' : 'unknown');
    if (has && !over.position) route('permitR2', `${say(over)}.${over.isValid ? ' Tap it to see the prompt of the browser.' : ''}`, over.isValid ? 'works' : 'blocked');
  };
  for (const el of [inside, over]) el.addEventListener('validationstatuschange', routes);
  setTimeout(() => { routes(); stage.request(); }, 1200);
  // #endregion permit
  return { stage };
}
