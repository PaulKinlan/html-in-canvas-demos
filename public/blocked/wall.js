import { mount, put, colors, clamp, smooth } from '/form-state/kit.js';
import { copyOf, frames, route, otherOrigin } from './probe.js';

const NAMES = ['harbour', 'hill', 'market', 'night', 'harbour', 'hill', 'market', 'night', 'harbour'];
const ROWS = ['this origin', 'second origin, no crossorigin attribute', 'second origin, crossorigin="anonymous"'];

export default function start() {
  const canvas = document.getElementById('wallCanvas'), out = document.getElementById('wallOut'), fix = document.getElementById('wallFix');
  const other = otherOrigin();
  // #region wall
  // Nine <img> elements, each a drawable child of the canvas. Row 1 comes from this origin. Rows 2 and
  // 3 come from a second origin that sends Access-Control-Allow-Origin: *. Row 3 asks for CORS with the
  // crossorigin attribute and row 2 does not. The canvas can tell which pictures will be left out
  // without reading a pixel: a different origin and no crossorigin attribute. It draws a hatched
  // card with the alt text behind each of those.
  const imgs = NAMES.map((name, i) => {
    const img = document.createElement('img');
    img.setAttribute('drawable', '');
    img.alt = `${name[0].toUpperCase()}${name.slice(1)}, a drawing`;
    img.width = 104; img.height = 78;
    if (i >= 6) img.crossOrigin = 'anonymous';
    img.src = `${i < 3 ? '' : other}/block-play/img/${name}.svg`;
    img.addEventListener('load', () => stage.request());
    img.addEventListener('error', () => stage.request());
    canvas.append(img);
    return img;
  });
  const foreign = (img) => new URL(img.src, location.href).origin !== location.origin && img.crossOrigin === null;
  let bare = false, t0 = performance.now(), flip = -1e9;
  const cells = [];
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), tw = 104, th = 78, gap = Math.max(6, Math.min(16, (w - 3 * tw - 24) / 2)), x0 = (w - 3 * tw - 2 * gap) / 2;
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    imgs.forEach((img, i) => {
      const row = Math.floor(i / 3), col = i % 3, x = x0 + col * (tw + gap), y = 26 + row * (th + 30);
      if (col === 0 && !bare) { ctx.fillStyle = c.muted; ctx.fillText(ROWS[row], x0, y - 7); }
      const inT = smooth(clamp((t - t0 - i * 60) / 420)), f = row === 1 ? clamp((t - flip) / 500) : 1;
      const sx = Math.abs(Math.cos(f * Math.PI)) || 0.02, tilt = (1 - inT) * 0.5 * (col - 1);
      cells[i] = { x: x + tw / 2, y: y + th / 2 };
      ctx.save();
      ctx.translate(x + tw / 2, y + th / 2 + (1 - inT) * 26); ctx.rotate(tilt); ctx.scale(sx, 1); ctx.globalAlpha = inT;
      if (!bare && (foreign(img) || !img.naturalWidth)) {
        ctx.fillStyle = c.bg; ctx.strokeStyle = c.bad; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-tw / 2, -th / 2, tw, th); ctx.fill();
        ctx.save(); ctx.clip(); ctx.globalAlpha = 0.25 * inT; ctx.beginPath();
        for (let d = -th; d < tw; d += 9) { ctx.moveTo(-tw / 2 + d, th / 2); ctx.lineTo(-tw / 2 + d + th, -th / 2); }
        ctx.stroke(); ctx.restore();
        ctx.strokeRect(-tw / 2, -th / 2, tw, th);
        ctx.fillStyle = c.fg; ctx.textAlign = 'center'; ctx.fillText(img.naturalWidth ? img.alt : 'did not load', 0, -2, tw - 8);
        ctx.fillStyle = c.bad; ctx.fillText(img.naturalWidth ? 'left out' : '', 0, 16);
      }
      put(ctx, img, -tw / 2, -th / 2);
      ctx.restore();
    });
    const n = imgs.filter(foreign).length, ok = imgs.filter((i) => i.naturalWidth).length;
    out.textContent = `Second origin: ${other}. Pictures loaded: ${ok} of 9. Pictures the page expects the canvas to leave out: ${n}.`;
    return t - t0 < 1100 || t - flip < 520;
  });
  // The repair: ask for the same files again with CORS. The query string keeps the browser from
  // reusing the answer it fetched without CORS.
  fix.addEventListener('click', () => {
    const again = fix.getAttribute('aria-pressed') !== 'true';
    fix.setAttribute('aria-pressed', again);
    fix.textContent = again ? 'Load row 2 without CORS again' : 'Load row 2 again with crossorigin';
    for (const img of imgs.slice(3, 6)) {
      if (again) img.crossOrigin = 'anonymous'; else img.removeAttribute('crossorigin');
      img.src = `${img.src.split('?')[0]}?${again ? 'cors' : 'plain'}`;
    }
    flip = performance.now(); stage.request();
  });
  // #endregion wall

  // #region wall-measure
  // After a tap: one frame is drawn with nothing behind the pictures, and the alpha of the middle of
  // each tile is read from a copy.
  document.getElementById('wallMeasure').addEventListener('click', async () => {
    t0 = -1e9; flip = -1e9; bare = true;
    stage.request(); await frames(3);
    const copy = copyOf(canvas);
    const got = imgs.map((img, i) => copy.at(cells[i].x, cells[i].y)[3] > 0);
    copy.done(); bare = false; stage.request();
    const row = (r) => got.slice(r * 3, r * 3 + 3).filter(Boolean).length;
    const loaded = (r) => imgs.slice(r * 3, r * 3 + 3).filter((i) => i.naturalWidth).length;
    const cors2 = imgs[3].crossOrigin !== null;
    route('wallR1', `${row(1)} of 3 pictures are in the canvas (${loaded(1)} of 3 loaded). Row 2 was loaded ${cors2 ? 'with' : 'without'} the crossorigin attribute.`, row(1) === 3 ? 'works' : 'blocked');
    route('wallR2', `${row(2)} of 3 pictures are in the canvas (${loaded(2)} of 3 loaded). This origin: ${row(0)} of 3.`, row(2) === 3 ? 'works' : 'blocked');
  });
  // #endregion wall-measure
  return { stage };
}
