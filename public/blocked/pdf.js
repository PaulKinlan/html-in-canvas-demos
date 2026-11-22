import { mount, put, colors } from '/form-state/kit.js';
import { copyOf, near, frames, sleep, route } from './probe.js';

const PAPER = [253, 246, 227];

export default function start() {
  const canvas = document.getElementById('pdfCanvas'), left = document.getElementById('pdfLeft'), right = document.getElementById('pdfRight');
  const out = document.getElementById('pdfOut'), open = document.getElementById('pdfOpen'), measure = document.getElementById('pdfMeasure');
  let loaded = false, result = null, bare = false;
  // The two transforms are kept so the measurement can find the same places.
  const at = { left: new DOMMatrix(), right: new DOMMatrix() };
  // #region pdf
  // Two pages of one PDF file: page 1 in an <embed>, page 2 in an <iframe>. Each is inside a drawable
  // block, and the canvas draws the two blocks as the pages of an open book. The paper is part of
  // each block, so a page whose PDF is left out of the picture is drawn as blank paper.
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), pw = left.offsetWidth, ph = left.offsetHeight;
    const a = (1 - open.value / 100) * 1.2, co = Math.cos(a), si = Math.sin(a) * 0.4;
    const k = Math.min(1, (w - 28) / (pw * 2)), cx = w / 2, top = 36;
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.ellipse(cx, top + ph * k + 16, pw * k * co + 10, 12, 0, 0, 7); ctx.fill();
    for (const [side, el, sx] of [['left', left, -1], ['right', right, 1]]) {
      ctx.save();
      ctx.translate(cx, top); ctx.scale(k, k); ctx.transform(co, sx * si, 0, 1, 0, 0);
      const x = sx < 0 ? -pw : 0;
      at[side] = ctx.getTransform().translate(x, 0);
      put(ctx, el, x, 0);
      // The shade of the fold, over the page.
      const g = ctx.createLinearGradient(sx < 0 ? 0 : 0, 0, sx * pw, 0);
      g.addColorStop(0, `rgba(0,0,0,${0.28 + 0.3 * (1 - co)})`); g.addColorStop(0.25, 'rgba(0,0,0,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      if (!bare) { ctx.fillStyle = g; ctx.fillRect(x, 0, pw, ph); }
      ctx.strokeStyle = c.line; ctx.strokeRect(x, 0, pw, ph);
      ctx.restore();
    }
    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('embed, page 1', cx - pw * k * co / 2, top + ph * k + 40);
    ctx.fillText('iframe, page 2', cx + pw * k * co / 2, top + ph * k + 40);
    if (result) {
      ctx.font = '600 13px system-ui, sans-serif';
      for (const [side, sx] of [['left', -1], ['right', 1]]) {
        if (result[side].ink) continue;
        ctx.fillStyle = c.bad; ctx.fillText('blank in the picture', cx + sx * pw * k * co / 2, top + ph * k * 0.78);
      }
    }
    out.textContent = `The book is ${open.value}% open. The PDF is ${loaded ? 'loaded into both pages' : 'not loaded yet'}. navigator.pdfViewerEnabled is ${navigator.pdfViewerEnabled}.`;
    return false;
  });
  open.addEventListener('input', () => stage.request());
  // #endregion pdf

  // #region pdf-measure
  // The PDF is fetched only after a tap, because a browser with no PDF viewer may offer to download
  // it. Then 192 points on each page are read from a copy of the canvas, drawn for one frame without the
  // shade of the fold. Page 1 of the file has a red band at its top and page 2 a green one.
  measure.addEventListener('click', async () => {
    measure.disabled = true;
    if (!loaded) {
      left.querySelector('embed').type = 'application/pdf';
      left.querySelector('embed').src = 'tides.pdf#page=1&toolbar=0&navpanes=0&view=Fit';
      right.querySelector('iframe').src = 'tides.pdf#page=2&toolbar=0&navpanes=0&view=Fit';
      loaded = true;
      route('pdfR1', 'Loading the PDF.'); route('pdfR2', 'Loading the PDF.');
      await sleep(2500);
    }
    open.value = 100; result = null; bare = true;
    stage.request(); await frames(4);
    const copy = copyOf(canvas), pw = left.offsetWidth, ph = left.offsetHeight, cr = canvas.getBoundingClientRect();
    result = {};
    const s = canvas.width / canvas.clientWidth;
    for (const [side, el, band] of [['left', left, (q) => q[0] > 170 && q[1] < 90 && q[2] < 90], ['right', right, (q) => q[1] > 120 && q[0] < 80 && q[2] < 120]]) {
      let paper = 0, white = 0, ink = 0, other = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 16; j++) {
        const p = at[side].transformPoint(new DOMPoint(pw * (i + 0.5) / 12, ph * (j + 0.5) / 16));
        const px = copy.at(p.x / s, p.y / s);
        if (px[3] > 200 && band(px)) ink++; else if (near(px, [255, 255, 255], 8)) white++; else if (near(px, PAPER, 30)) paper++; else other++;
      }
      const mid = at[side].transformPoint(new DOMPoint(pw / 2, ph / 2));
      const hit = document.elementFromPoint(cr.left + mid.x / s, cr.top + mid.y / s);
      result[side] = { paper, white, ink, other, hit: hit?.localName ?? 'nothing' };
    }
    copy.done(); bare = false;
    const say = (r, colour) => `${r.ink ? `Drawn: ${r.ink} of 192 points have the ${colour} of the band at the top of the page.` : `Not in the picture: 0 of 192 points have the ${colour} of the band at the top of the page. ${r.paper} are bare paper, ${r.white} white, ${r.other} something else.`} A tap in the middle of the page lands on the ${r.hit}.`;
    route('pdfR1', say(result.left, 'red'), result.left.ink ? 'works' : 'blocked');
    route('pdfR2', say(result.right, 'green'), result.right.ink ? 'works' : 'blocked');
    stage.request();
    measure.disabled = false;
  });
  // #endregion pdf-measure
  return { stage };
}
