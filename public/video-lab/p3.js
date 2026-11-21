// p3.js: the wide-gamut part of /video-lab/. The same element (a video and three
// CSS swatches) is drawn into a 2D canvas whose context is sRGB and into one
// whose context is Display P3. Pixels are read from drawImage() copies in plain
// canvases, never from the drawable canvases themselves.

export const CLIPS = {
  wide: { src: '/video-lab/wide.webm', label: 'BT.2020 primaries, 8 bit' },
  hdr: { src: '/video-lab/hdr.webm', label: 'HDR10: BT.2020, PQ, 10 bit' },
};

const MARKUP = `<video muted playsinline loop preload="metadata"></video>
  <div class="swatches"><i style="background:color(display-p3 1 0 0)"></i><i style="background:color(display-p3 0 1 0)"></i><i style="background:color(display-p3 0 0 1)"></i></div>`;

// #region p3-context
/** A drawable canvas with a 2D context in `colorSpace`, drawing one child element on every paint. */
export function gamutCanvas(canvas, colorSpace, { colorType = 'unorm8', after = null } = {}) {
  const el = document.createElement('div');
  el.className = 'p3-el';
  el.setAttribute('drawable', '');
  el.innerHTML = MARKUP;
  canvas.replaceChildren(el);
  const ctx = canvas.getContext('2d', { colorSpace, colorType });
  const attrs = ctx.getContextAttributes?.() ?? {};
  canvas.addEventListener('paint', () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.reset();
    ctx.drawElementImage(el, 0, 0, w, h);
    after?.(ctx, w, h);
  });
  return { canvas, el, video: el.querySelector('video'), ctx, colorSpace: attrs.colorSpace ?? 'srgb', colorType: attrs.colorType ?? 'unorm8' };
}
// #endregion p3-context

// #region p3-read
/** Copy a canvas into a plain canvas with the same colour space and return its pixels as Display P3 values. */
export function readAsP3(source, colorSpace) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const c = copy.getContext('2d', { colorSpace, willReadFrequently: true });
  c.drawImage(source, 0, 0);
  return c.getImageData(0, 0, copy.width, copy.height, { colorSpace: 'display-p3' });
}
// #endregion p3-read

// Display P3 (8 bit, encoded) to linear sRGB. A component below 0 or above 1 is a colour sRGB cannot show.
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function p3ToLinearSrgb(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  return [1.2249401 * r - 0.2249404 * g, -0.0420569 * r + 1.0420571 * g, -0.0196376 * r - 0.0786361 * g + 1.0982735 * b];
}
export const outsideSrgb = (r, g, b) => { const s = p3ToLinearSrgb(r, g, b); return Math.min(...s) < -0.02 || Math.max(...s) > 1.02; };

/** How much of a picture (ImageData in P3 values) is outside sRGB, and a map of where, drawn into `into`. */
export function gamutMap(image, into = null) {
  const { data, width, height } = image;
  let outside = 0;
  const out = into ? new ImageData(width, height) : null;
  for (let i = 0; i < data.length; i += 4) {
    const far = outsideSrgb(data[i], data[i + 1], data[i + 2]);
    if (far) outside++;
    if (out) {
      const grey = (data[i] + data[i + 1] + data[i + 2]) / 9;
      out.data[i] = far ? 255 : grey; out.data[i + 1] = far ? 40 : grey; out.data[i + 2] = far ? 200 : grey; out.data[i + 3] = 255;
    }
  }
  if (into) {
    if (into.width !== width || into.height !== height) { into.width = width; into.height = height; }
    into.getContext('2d').putImageData(out, 0, 0);
  }
  return outside / (width * height);
}
