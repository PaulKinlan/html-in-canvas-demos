import { mount, put, clamp } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('floorCanvas'), footer = document.getElementById('floorFooter'), out = document.getElementById('floorOut');
  const tilt = document.getElementById('floorTilt'), signs = [...canvas.querySelectorAll('.sign')];
  let shown = Number(tilt.value), last = '';
  // #region floor
  // The footer lies on the ground. A DOMMatrix with a perspective row turns its rectangle about its near
  // edge. A 2D context cannot draw with that matrix, so the picture is drawn in strips 3 px deep, each at
  // the place and the size the matrix gives for it. The same matrix is then given to
  // updateElementGeometry(), so the browser hit-tests the footer's links on the slanted floor.
  const DEPTH = 420, STRIP = 3;
  const stage = mount(canvas, (ctx, w, h) => {
    const target = Number(tilt.value);
    shown += clamp(target - shown, -3, 3);
    const fw = footer.offsetWidth, fh = footer.offsetHeight, k = Math.min(1, (w - 8) / fw);
    const M = new DOMMatrix().translate(w / 2, h - 16).scale(k);
    M.multiplySelf(new DOMMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / DEPTH, 0, 0, 0, 1]));
    M.rotateSelf(shown, 0, 0).translateSelf(-fw / 2, -fh);
    const project = (x, y) => { const p = M.transformPoint(new DOMPoint(x, y, 0, 1)); return { x: p.x / p.w, y: p.y / p.w, s: k / p.w }; };
    const far = project(fw / 2, 0);
    // The wall behind, down to the far edge of the floor.
    const sky = ctx.createLinearGradient(0, 0, 0, far.y);
    sky.addColorStop(0, '#dfe9f5'); sky.addColorStop(1, '#f6efe2');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, far.y);
    ctx.fillStyle = '#cfc6b4'; ctx.fillRect(0, far.y, w, h - far.y);
    for (let y = 0; y < fh; y += STRIP) {
      const a = project(0, y), b = project(fw, y), below = project(0, y + STRIP);
      ctx.save();
      ctx.translate(a.x, a.y); ctx.scale((b.x - a.x) / fw, (below.y - a.y) / STRIP);
      ctx.beginPath(); ctx.rect(0, 0, fw, STRIP + 2); ctx.clip();
      put(ctx, footer, 0, -y);
      ctx.restore();
    }
    // The far part of the floor is a little darker.
    const shade = ctx.createLinearGradient(0, far.y, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,.28)'); shade.addColorStop(0.6, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade; ctx.fillRect(0, far.y, w, h - far.y);
    try { canvas.updateElementGeometry(footer, { canvasTransform: M }); } catch {}
    // The signs stand on the floor: each has a place on the footer, and is drawn upright there at the
    // size the matrix gives for that depth, the far one first.
    signs.forEach((sign, i) => {
      const at = project(fw * (i ? 0.74 : 0.24), fh * (i ? 0.34 : 0.1)), sw = sign.offsetWidth, sh = sign.offsetHeight;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(at.x, at.y, sw * at.s * 0.5, 7 * at.s, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s); put(ctx, sign, -sw / 2, -sh); ctx.restore();
    });
    out.textContent = `Floor tilted back by ${Math.round(shown)} degrees. Its far edge is ${Math.round(far.s / k * 100)}% of the width of its near edge. Last thing tapped: ${last || 'nothing yet'}.`;
    return shown !== target;
  });
  // #endregion floor
  tilt.addEventListener('input', () => stage.request());
  canvas.addEventListener('click', (e) => {
    const a = e.target.closest('a, button');
    if (!a) return;
    e.preventDefault();
    last = `${a.textContent.trim()} (${a.closest('footer') ? 'a link in the footer' : 'the button on a sign'})`;
    stage.request();
  });
  return { stage };
}
