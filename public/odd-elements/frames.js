import { mount, put, colors } from '/form-state/kit.js';
import { lay } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('framesCanvas'), sheet = document.getElementById('framesSheet'), out = document.getElementById('framesOut');
  const warn = document.getElementById('framesWarn'), frames = [...sheet.querySelectorAll('iframe')], taps = frames.map(() => 0);
  let drawn = 0;
  // Each frame holds one button that tells this page when it is pressed.
  const inner = (colour) => `<body style="margin:0;background:${colour};font:16px system-ui"><button style="width:100%;height:100%;font:inherit;background:none;border:0" onclick="parent.postMessage('frame-tap','*')">A button in the frame</button>`;
  frames[0].srcdoc = inner('#bfe3c0');
  frames[1].src = `data:text/html,${encodeURIComponent(inner('#f4c8a0'))}`;
  frames[2].srcdoc = inner('#c7c9f2');
  addEventListener('message', (e) => {
    const i = frames.findIndex((f) => f.contentWindow === e.source);
    if (i < 0 || e.data !== 'frame-tap') return;
    taps[i]++; stage.request();
  });
  // #region frames
  // A frame from another origin is left out of the picture of the element around it: its box is empty.
  // It still takes the tap. A script cannot look at the pixels to find such a frame without a readback,
  // but it can ask for contentDocument, which is null for another origin. The canvas draws a hatched
  // box with a label over each one.
  const foreign = (frame) => { try { return !frame.contentDocument; } catch { return true; } };
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    lay(ctx, canvas, sheet, w, h, ({ local }) => {
      put(ctx, sheet, 0, 0);
      frames.forEach((frame, i) => {
        if (!foreign(frame) || !warn.checked) return;
        const b = local(frame.getBoundingClientRect());
        ctx.save();
        ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
        ctx.fillStyle = 'rgba(217,119,6,.14)'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#d97706'; ctx.lineWidth = 2;
        ctx.beginPath(); for (let d = -b.h; d < b.w; d += 12) { ctx.moveTo(b.x + d, b.y + b.h); ctx.lineTo(b.x + d + b.h, b.y); } ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = '#d97706'; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
        const label = `Not drawn. Taps it took: ${taps[i]}`;
        ctx.font = '600 13px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        const lw = ctx.measureText(label).width + 16;
        ctx.fillStyle = c.card; ctx.beginPath(); ctx.roundRect(b.x + b.w / 2 - lw / 2, b.y + b.h / 2 - 12, lw, 24, 6); ctx.fill();
        ctx.fillStyle = '#92400e'; ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      });
    });
    out.textContent = `Taps: ${taps[0]} in the frame from this origin, ${taps[1]} in the data: frame, ${taps[2]} in the sandboxed frame. Frames with no contentDocument: ${frames.filter(foreign).length} of ${frames.length}.`;
    return drawn++ < 6;
  });
  // #endregion frames
  warn.addEventListener('change', () => stage.request());
  for (const f of frames) f.addEventListener('load', () => { drawn = 0; stage.request(); });
  return { stage };
}
