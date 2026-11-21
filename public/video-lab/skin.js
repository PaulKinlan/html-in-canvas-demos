// skin.js: the timeline skin scene of /video-lab/. One <video controls> fills
// the canvas. The shader changes only the pixels of the native timeline, which
// the page finds by colouring that part for one paint and reading the picture back.

import { place } from './gl.js';

export const SKINS = ['none', 'neon', 'blocks', 'scope'];

export function createSkin(canvas, { onBox = () => {} } = {}) {
  const player = document.createElement('div');
  player.className = 'skin-player';
  player.setAttribute('drawable', '');
  // #region skin-markup
  player.innerHTML = '<video controls muted playsinline loop preload="metadata"></video>';
  // #endregion skin-markup
  const video = player.firstChild;
  video.dataset.src = '/media/clip.webm';
  canvas.append(player);

  let kind = 1, box = null, probing = false, wanted = true, probeTex = null, fbo = null, timer = 0;
  const ask = (ms = 350) => { clearTimeout(timer); timer = setTimeout(() => { wanted = true; canvas.requestPaint(); }, ms); };
  for (const type of ['loadeddata', 'play', 'pause', 'pointerdown', 'pointerenter']) video.addEventListener(type, () => ask());
  new ResizeObserver(() => ask(100)).observe(canvas);

  // #region skin-measure
  // Runs in a paint where the timeline has a flat magenta background (the class "probe").
  // The picture goes into a spare texture, is read once, and is never drawn.
  function measure(view) {
    const gl = view.gl.gl;
    const size = canvas.getElementImageDefaultSize(player);
    const w = Math.max(1, Math.ceil(size.width)), h = Math.max(1, Math.ceil(size.height));
    probeTex ??= gl.createTexture();
    fbo ??= gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, probeTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, player);
    // The timeline is in the bottom quarter of the player: read only that.
    const y0 = Math.floor(h * 0.75), rows = h - y0, px = new Uint8Array(w * rows * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probeTex, 0);
    gl.readPixels(0, y0, w, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let x0 = w, x1 = -1, top = h, bottom = -1, count = 0;
    for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < w; x++, i += 4) {
      if (px[i] < 243 || px[i + 1] > 12 || px[i + 2] < 243) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y + y0 < top) top = y + y0;
      if (y + y0 > bottom) bottom = y + y0;
    }
    if (count < 40) return null; // the controls are not showing now: keep the last box
    return [x0 / w, top / h, (x1 + 1) / w, (bottom + 1) / h];
  }
  // #endregion skin-measure

  const scene = {
    video, player,
    elements: () => [player],
    near() { if (!video.src) video.src = video.dataset.src; },
    away() { if (!video.paused) video.pause(); },
    leave() { if (!video.paused) video.pause(); },
    enter() { wanted = true; },
    animated: () => kind !== 0,
    // #region skin-paint
    paint(view) {
      place(canvas, player, new DOMMatrix());
      if (probing) {
        // This paint has the probe colour. Measure it and draw the last normal picture.
        probing = false;
        player.classList.remove('probe');
        const found = measure(view);
        if (found) { box = found; onBox(box); }
      } else if (!view.upload(player)) {
        return;
      }
      if (wanted && video.readyState >= 1) { wanted = false; probing = true; player.classList.add('probe'); canvas.requestPaint(); }
      if (!view.record(player)) return;
      view.quad(player, view.full(), {
        mode: 2, kind,
        set: (gl, u) => {
          gl.uniform4fv(u('uBox'), box ?? [1, 0, 0, 0]);
          gl.uniform1f(u('uPlayed'), video.duration ? video.currentTime / video.duration : 0);
        },
      });
    },
    // #endregion skin-paint
    set kind(k) { kind = k; canvas.requestPaint(); },
    get kind() { return kind; },
    get box() { return box; },
    probe() { wanted = true; canvas.requestPaint(); },
  };
  return scene;
}
