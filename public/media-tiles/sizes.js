import { mount, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('resCanvas');
  const picture = document.getElementById('resPicture');
  const img = document.getElementById('resImg');
  const out = document.getElementById('resOut');
  const slider = document.getElementById('resWidth');
  const during = document.getElementById('resDuring');
  const WIDTHS = [160, 320, 640, 1280];
  const MIN = 40, MAX = 1400;
  // The slider is logarithmic: each step multiplies the drawn width by the same amount.
  const toWidth = (v) => Math.round(MIN * (MAX / MIN) ** (v / 1000));
  const toValue = (w) => Math.round(1000 * Math.log(w / MIN) / Math.log(MAX / MIN));
  let width = toWidth(Number(slider.value)), told = 0, paints = 0, version = 0, walk = null, settle = 0;
  const fetched = [];

  // #region sizes
  // The image is laid out once, at 160 CSS pixels wide, and never laid out again. The scene draws it at
  // any width with drawElementImage(img, x, y, width, height). The page tells the browser that width
  // through the `sizes` attribute of the <source> and the <img>, and the browser picks a file from srcset.
  function tell(px) {
    if (px === told) return;
    told = px;
    for (const el of picture.children) el.sizes = `${px}px`;
  }
  // Each new file changes the image's picture, which raises `paint`. There is no load listener.
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    if (walk) {
      const p = clamp((t - walk.t0) / walk.ms), e = p * p * (3 - 2 * p);
      width = Math.round(walk.from * (walk.to / walk.from) ** e);
      slider.value = toValue(width);
      if (p >= 1) walk = null;
    }
    if (during.checked || !walk) tell(width);
    const ih = width * 9 / 16, cx = w / 2, cy = h * 0.46;
    // A wall, a floor, a lamp, and the picture in a frame.
    ctx.fillStyle = '#d9d2c4'; ctx.fillRect(0, 0, w, h);
    const lamp = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, Math.max(140, width * 0.9));
    lamp.addColorStop(0, '#fffaf0'); lamp.addColorStop(1, '#fffaf000');
    ctx.fillStyle = lamp; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8f7d66'; ctx.fillRect(0, h * 0.88, w, h * 0.12);
    ctx.fillStyle = '#7a6a56'; for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 30, h * 0.88); ctx.lineTo(cx + i * 30 + 1.5, h * 0.88); ctx.lineTo(cx + i * 90 + 3, h); ctx.lineTo(cx + i * 90, h); ctx.fill(); }
    // A picture wider than the canvas keeps its top left corner, where the file's width is written, in view.
    const b = Math.max(3, width * 0.035);
    const px = Math.max(cx - width / 2, b + 6), py = Math.max(cy - ih / 2, b + 6);
    ctx.shadowColor = '#0006'; ctx.shadowBlur = b * 2; ctx.shadowOffsetY = b;
    ctx.fillStyle = '#2b2118'; ctx.fillRect(px - b, py - b, width + b * 2, ih + b * 2);
    ctx.shadowColor = 'transparent';
    let drawn = true;
    try {
      ctx.drawElementImage(img, px, py, width, ih);
      // A loupe in the corner: the part of the picture round the sun and the fence, 110 px across,
      // from the same element. It shows how many pixels the current file has for that part.
      const lx = w - 66, ly = h - 66, part = img.offsetWidth * 0.12;
      ctx.save();
      ctx.beginPath(); ctx.arc(lx, ly, 55, 0, 7); ctx.clip();
      ctx.drawElementImage(img, img.offsetWidth * 0.68 - part / 2, img.offsetHeight * 0.7 - part / 2, part, part, lx - 55, ly - 55, 110, 110);
      ctx.restore();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(lx, ly, 55, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lx, ly, 58, 0, 7); ctx.stroke();
      // The loupe's draw moved the image's hit region to the loupe. Put it back on the picture.
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); ctx.drawElementImage(img, px, py, width, ih); ctx.restore();
    } catch { drawn = false; }

    const file = (img.currentSrc.match(/hills-(\d+)\.(\w+)/) ?? []).slice(1);
    const need = Math.round(told * devicePixelRatio);
    out.textContent = `Drawn ${width} CSS px wide. sizes="${told}px" at devicePixelRatio ${+devicePixelRatio.toFixed(3)} needs ${need} px. `
      + `currentSrc: ${file.length ? `${file[0]}w (${file[1]})` : 'none yet'}. Files fetched, in order: ${fetched.join(', ') || 'none'}. Paint events: ${paints}.`;
    return !!walk || !drawn;
  });
  // #endregion sizes

  // #region sizes-log
  // Which files the browser fetched, from the Resource Timing entries of this page.
  const urls = new Set();
  const seen = (entries) => {
    for (const e of entries) {
      const m = e.name.match(/hills-(\d+)\.(\w+)(\?v=(\d+))?$/);
      if (m && Number(m[4] ?? 0) === version && !urls.has(e.name)) { urls.add(e.name); fetched.push(`${m[1]}w`); stage.request(); }
    }
  };
  try { new PerformanceObserver((list) => seen(list.getEntries())).observe({ type: 'resource', buffered: true }); } catch {}
  // #endregion sizes-log

  slider.addEventListener('input', () => { walk = null; width = toWidth(Number(slider.value)); stage.request(); });
  const go = (to) => { walk = { from: width, to, t0: performance.now(), ms: 2600 }; stage.request(); };
  document.getElementById('resNear').addEventListener('click', () => go(MAX));
  document.getElementById('resFar').addEventListener('click', () => go(MIN));
  during.addEventListener('change', () => stage.request());

  // #region sizes-again
  // Chromium keeps the largest file it has loaded and does not go back to a smaller one. To watch the
  // choice again from the start, give every candidate a new URL, which the browser has not loaded.
  document.getElementById('resAgain').addEventListener('click', () => {
    version++;
    fetched.length = 0;
    walk = null; width = MIN; slider.value = toValue(width); told = 0;
    for (const el of picture.children) {
      el.sizes = `${MIN}px`;
      el.srcset = WIDTHS.map((n) => `/media-tiles/img/hills-${n}.${el.localName === 'source' ? 'webp' : 'jpg'}?v=${version} ${n}w`).join(', ');
    }
    stage.request();
  });
  // #endregion sizes-again
  return { stage };
}
