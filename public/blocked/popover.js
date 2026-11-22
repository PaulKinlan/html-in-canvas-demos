import { mount, put, colors } from '/form-state/kit.js';
import { copyOf, near, frames, route } from './probe.js';

const CARD = [253, 230, 138];

export default function start() {
  const canvas = document.getElementById('popoverCanvas'), card = document.getElementById('popCard'), toggle = document.getElementById('popToggle');
  const out = document.getElementById('popoverOut');
  let t0 = performance.now(), pushes = 0, amp = 0.5, tried = null, probe = false;
  const top = () => card.matches(':popover-open');
  // #region popover
  // One card, two homes. In the scene it has no popover attribute: it is an ordinary drawable child,
  // and the canvas hangs it from a string and lets it swing. In the top layer it has popover="auto"
  // and is shown with showPopover(): the browser draws it over the page, and the canvas has no
  // picture of it, so it draws a dashed outline where the card hung. A light dismiss (a tap outside,
  // or Escape) closes the popover, and the toggle event puts the card back on its string.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), cw = card.offsetWidth || 236, ch = card.offsetHeight || 150, s = (t - t0) / 1000;
    const a = top() ? 0 : amp * Math.exp(-s * 0.9) * Math.cos(s * 4.2);
    ctx.save();
    ctx.translate(w / 2, 6); ctx.rotate(a);
    ctx.strokeStyle = c.fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 56); ctx.stroke();
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(0, 2, 6, 0, 7); ctx.fill();
    if (top()) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = c.muted; ctx.strokeRect(-118, 56, 236, 150); ctx.setLineDash([]);
      ctx.fillStyle = c.muted; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('The canvas has no picture of the card.', 0, 228);
      // Asked for by the measurement: draw the open popover anyway and see what happens.
      if (probe) { try { ctx.drawElementImage(card, -118, 56, 236, 150); tried = 'did not throw'; } catch (e) { tried = `threw ${e.name}`; } }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(-cw / 2 + 6, 64, cw, ch);
      put(ctx, card, -cw / 2, 56);
    }
    ctx.restore();
    out.textContent = top()
      ? 'The card has popover="auto" and :popover-open matches. Tap outside it, or press Escape, and it returns to the scene.'
      : `The card has no popover attribute and is drawn by the canvas. Pushes: ${pushes}.`;
    return !top() && s < 6;
  });
  // In Chromium 157 an open popover that is a child of the canvas is shown where the canvas last drew
  // it, turned as it was turned. So the card is first placed straight, on the dashed outline.
  const toTop = () => {
    try { canvas.updateElementGeometry(card, { canvasTransform: new DOMMatrix().translate(canvas.clientWidth / 2 - card.offsetWidth / 2, 62) }); } catch {}
    card.setAttribute('popover', 'auto'); card.showPopover(); toggle.textContent = 'Put it back in the scene'; stage.request();
  };
  const toScene = () => { if (top()) card.hidePopover(); card.removeAttribute('popover'); toggle.textContent = 'Move it to the top layer'; t0 = performance.now(); amp = 0.5; stage.request(); };
  toggle.addEventListener('click', () => (top() ? toScene() : toTop()));
  card.addEventListener('toggle', (e) => { if (e.newState === 'closed' && card.hasAttribute('popover')) toScene(); });
  // A tap on the canvas beside the card pushes it.
  canvas.addEventListener('pointerdown', (e) => { if (e.target !== canvas || top()) return; pushes++; amp = 0.42; t0 = performance.now(); stage.request(); });
  // #endregion popover

  // #region popover-measure
  let hits = 0;
  document.getElementById('popoverMeasure').addEventListener('click', async () => {
    if (!top()) toTop();
    probe = true; tried = null;
    stage.request(); await frames(3);
    probe = false;
    const copy = copyOf(canvas), w = canvas.clientWidth;
    let drawn = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (near(copy.at(w / 2 - 90 + i * 90, 78 + j * 22), CARD)) drawn++;
    copy.done();
    route('popoverR1', `drawElementImage() of the open popover ${tried ?? 'was not reached'}. ${drawn} of 9 points where it was drawn have the card's colour.`, drawn ? 'works' : 'blocked');
    stage.request();
  });
  card.addEventListener('click', (e) => { if (e.target.closest('button') && !top()) route('popoverR2', `A tap reached the button of the swinging card ${++hits} time${hits === 1 ? '' : 's'}.`, 'works'); });
  // #endregion popover-measure
  return { stage };
}
