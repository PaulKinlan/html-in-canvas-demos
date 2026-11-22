import { mount, put, place, park, clamp } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('monitorCanvas'), page = document.getElementById('monitorPage'), out = document.getElementById('monitorOut');
  const power = document.getElementById('monitorPower'), sign = document.getElementById('monitorSign'), count = document.getElementById('monitorCount');
  let on = true, t0 = -1e9, entries = 0, cache = null, flat = null, lastFull = 0, dirty = true;
  // #region monitor
  // The page inside the monitor is one drawable <div> written with <center>, <font>, <big>, <tt> and
  // <marquee>. It is drawn once, flat, and that part of the canvas is copied into a plain canvas with
  // drawImage(). The tube is then made from the copy: 11 strips, each a little narrower towards the top
  // and the bottom, so the picture bulges, a second, larger copy added on top for the glow, dark lines
  // and a shadow round the edge. Nothing is read back from either canvas.
  // The marquee raises `paint` 60 times a second, and that is the only clock: the page has no frame
  // loop of its own while the power is on. The tube is built 12 times a second. On the events in
  // between, a copy of the last whole frame is put back.
  const STRIPS = 11, EVERY = 1000 / 12;
  const sized = (c, w, h) => { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; return c.getContext('2d'); };
  const stage = mount(canvas, (ctx, w, h, t) => {
    const pw = page.offsetWidth, ph = page.offsetHeight, k = Math.min(1, (w - 64) / pw), sw = pw * k, sh = ph * k, sx = (w - sw) / 2, sy = 32;
    const dpr = canvas.width / canvas.clientWidth || 1;
    const aim = () => { if (on) { ctx.save(); ctx.translate(sx, sy); ctx.scale(k, k); place(ctx, page, 0, 0); ctx.restore(); } else park(canvas, page); };
    if (!dirty && t - t0 > 420 && t - lastFull < EVERY && cache && cache.width === canvas.width && cache.height === canvas.height) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cache, 0, 0); ctx.restore();
      aim();
      return false;
    }
    // The page, flat, and a copy of those pixels.
    ctx.save(); ctx.translate(sx, sy); ctx.scale(k, k); const got = put(ctx, page, 0, 0); ctx.restore();
    flat ??= document.createElement('canvas');
    const fw = Math.round(sw * dpr), fh = Math.round(sh * dpr), f = sized(flat, fw, fh);
    f.clearRect(0, 0, fw, fh); f.drawImage(canvas, Math.round(sx * dpr), Math.round(sy * dpr), fw, fh, 0, 0, fw, fh);
    // The case, the stand and the lamp.
    ctx.fillStyle = '#cfc6ab'; ctx.beginPath(); ctx.roundRect(sx - 26, sy - 22, sw + 52, sh + 62, 18); ctx.fill();
    ctx.fillStyle = '#b3aa90'; ctx.fillRect(w / 2 - 50, sy + sh + 40, 100, 16); ctx.beginPath(); ctx.roundRect(w / 2 - 90, sy + sh + 54, 180, 12, 6); ctx.fill();
    ctx.fillStyle = '#17181a'; ctx.beginPath(); ctx.roundRect(sx - 9, sy - 9, sw + 18, sh + 18, 16); ctx.fill();
    ctx.fillStyle = on ? '#3ddc5a' : '#5a5a50'; ctx.beginPath(); ctx.arc(sx + sw + 8, sy + sh + 24, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#6f684f'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('CANVAS 14', sx - 12, sy + sh + 24);
    // v is 1 with the whole picture shown and 0 with none. On the way it shrinks to a line, then a dot.
    const u = clamp((t - t0) / 420), v = on ? u : 1 - u;
    const ys = v < 0.5 ? 0.012 : 0.012 + (v - 0.5) * 2 * 0.988, xs = v < 0.5 ? v * 2 : 1;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 10); ctx.clip();
    ctx.fillStyle = '#050805'; ctx.fillRect(sx, sy, sw, sh);
    if (v > 0 && got) {
      ctx.save();
      ctx.translate(sx + sw / 2, sy + sh / 2); ctx.scale(xs, ys); ctx.translate(-sw / 2, -sh / 2);
      for (let i = 0; i < STRIPS; i++) {
        const bulge = 1 - 0.045 * (2 * (i + 0.5) / STRIPS - 1) ** 2;
        ctx.drawImage(flat, 0, i * fh / STRIPS, fw, fh / STRIPS, sw * (1 - bulge) / 2, i * sh / STRIPS, sw * bulge, sh / STRIPS + 0.5);
      }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22 + (1 - v) * 0.7;
      ctx.drawImage(flat, -4, -3, sw + 8, sh + 6);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (let y = sy; y < sy + sh; y += 3) ctx.fillRect(sx, y, sw, 1);
    const g = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, sh * 0.3, sx + sw / 2, sy + sh / 2, sw * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g; ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    // Input goes to the page at the flat place of the screen. With the power off it goes nowhere.
    aim();
    out.textContent = `Power ${on ? 'on' : 'off'}. The page is ${pw} by ${ph} px, drawn once and cut into ${STRIPS} strips. Guestbook entries: ${entries}.`;
    // Keep this frame.
    cache ??= document.createElement('canvas');
    const keep = sized(cache, canvas.width, canvas.height);
    keep.clearRect(0, 0, cache.width, cache.height); keep.drawImage(canvas, 0, 0);
    lastFull = t; dirty = !got;
    return u < 1;
  });
  // #endregion monitor
  power.addEventListener('click', () => { on = !on; dirty = true; t0 = performance.now(); power.textContent = on ? 'Power off' : 'Power on'; stage.request(); });
  sign.addEventListener('click', () => { entries++; dirty = true; count.textContent = String(42 + entries).padStart(6, '0'); stage.request(); });
  return { stage };
}
