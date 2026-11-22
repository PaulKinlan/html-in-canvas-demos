import { mount, put, colors, clamp, back } from '/form-state/kit.js';
import { copyOf, near, frames, sleep, route } from './probe.js';

const PICKER = [124, 58, 237];   // the background the page gives ::picker(select)
const SAILS = { red: '#dc2626', tan: '#b45309', white: '#f8fafc', blue: '#2563eb', green: '#16a34a' };

export default function start() {
  const canvas = document.getElementById('pickerCanvas'), select = document.getElementById('pickerSelect'), list = document.getElementById('pickerList');
  const out = document.getElementById('pickerOut');
  let t0 = 0, taps = 0, from = 'nothing yet';
  // #region picker
  // Two controls with the same five options. The customisable select opens its picker in the top layer,
  // which no canvas can draw. The second is a list box (size="5"): its options are in the flow of the
  // element, so they are in its picture, and the canvas draws that picture sheared onto a panel. A
  // tap on a sheared row chooses it, because the hit region follows the draw.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = back(clamp((t - t0) / 500));
    const sw = select.offsetWidth;
    ctx.save(); ctx.translate((w - sw) / 2, 14); put(ctx, select, 0, 0); ctx.restore();
    // The panel with the list box.
    const lw = list.offsetWidth, lh = list.offsetHeight;
    ctx.save();
    ctx.translate(18, 112); ctx.transform(1, -0.16, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.roundRect(6, 8, lw + 20, lh + 20, 10); ctx.fill();
    ctx.fillStyle = c.bg; ctx.strokeStyle = c.line; ctx.beginPath(); ctx.roundRect(0, 0, lw + 20, lh + 20, 10); ctx.fill(); ctx.stroke();
    put(ctx, list, 10, 10);
    ctx.restore();
    // A boat whose sail takes the chosen colour.
    const bx = Math.max(lw + 110, w - 96), by = 250;
    ctx.fillStyle = c.line; ctx.fillRect(lw + 50, by + 22, w - lw - 62, 3);
    ctx.fillStyle = c.fg; ctx.beginPath(); ctx.moveTo(bx - 62, by); ctx.lineTo(bx + 62, by); ctx.lineTo(bx + 44, by + 22); ctx.lineTo(bx - 48, by + 22); ctx.closePath(); ctx.fill();
    ctx.fillRect(bx - 2, by - 132, 4, 132);
    ctx.save(); ctx.translate(bx + 2, by - 8); ctx.scale(0.55 + 0.45 * u, 1);
    ctx.fillStyle = SAILS[select.value] ?? c.accent; ctx.strokeStyle = c.fg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -122); ctx.quadraticCurveTo(70, -60, 56, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.translate(bx - 2, by - 8); ctx.scale(0.55 + 0.45 * u, 1);
    ctx.fillStyle = SAILS[select.value] ?? c.accent; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(0, -100); ctx.lineTo(-46, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    ctx.restore();
    out.textContent = `Sail: ${select.value}, chosen through ${from}. Choices made on the sheared list: ${taps}. The picker is ${select.matches(':open') ? 'open' : 'closed'}.`;
    return t - t0 < 560;
  });
  list.addEventListener('change', () => { select.value = list.value; taps++; from = 'the list drawn on the panel'; t0 = performance.now(); stage.request(); });
  select.addEventListener('change', () => { list.value = select.value; from = 'the picker in the top layer'; t0 = performance.now(); stage.request(); });
  // #endregion picker

  // #region picker-measure
  // After a tap: open the picker, then look in a copy of the canvas for the picker's colour at the
  // places where its rows are on the screen.
  document.getElementById('pickerMeasure').addEventListener('click', async () => {
    try { select.showPicker(); } catch (e) { route('pickerR1', `showPicker() threw: ${e.message}`); return; }
    await sleep(350);
    stage.request(); await frames(3);
    const cr = canvas.getBoundingClientRect(), copy = copyOf(canvas);
    let over = 0, drawn = 0;
    for (const o of select.options) {
      const r = o.getBoundingClientRect();
      for (const f of [0.6, 0.75, 0.9]) {
        const x = r.left + r.width * f - cr.left, y = r.top + r.height / 2 - cr.top;
        if (x < 0 || y < 0 || x >= cr.width || y >= cr.height) continue;
        over++; if (near(copy.at(x, y), PICKER)) drawn++;
      }
    }
    copy.done();
    const open = select.matches(':open');
    route('pickerR1', open
      ? `The picker is open. ${over} points on its rows lie over the canvas, and ${drawn} of them have the picker's colour in the canvas's pixels.`
      : 'showPicker() did not open the picker.', open && over ? (drawn ? 'works' : 'blocked') : 'unknown');
    stage.request();
  });
  list.addEventListener('change', () => route('pickerR2', `${taps} choice${taps === 1 ? '' : 's'} made by a tap on a sheared row. The list is ${list.offsetWidth} by ${list.offsetHeight} px in layout.`, 'works'));
  // #endregion picker-measure
  return { stage };
}
