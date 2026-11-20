// Performance wall worker: owns the OffscreenCanvas, keeps the latest
// ElementImage per element and draws all of them every frame.
let canvas, ctx, dpr = 1;
let images = [];
let sizes = [];
let deltas = [];
let last = 0;
let drawMs = 0, drawN = 0;

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    canvas = data.canvas; dpr = data.dpr;
    ctx = canvas.getContext('2d');
    requestAnimationFrame(frame);
  } else if (data.type === 'images') {
    for (const [i, img] of data.images) { images[i]?.close(); images[i] = img; }
    if (data.sizes) sizes = data.sizes;
  } else if (data.type === 'reset') {
    for (const img of images) img?.close();
    images = []; sizes = [];
    if (data.width) { canvas.width = data.width; canvas.height = data.height; dpr = data.dpr; }
  } else if (data.type === 'measure') {
    deltas = []; drawMs = 0; drawN = 0;
    setTimeout(() => {
      self.postMessage({ type: 'stats', deltas, drawMs: drawN ? drawMs / drawN : 0 });
    }, data.ms);
  }
};

function frame(t) {
  requestAnimationFrame(frame);
  if (last) deltas.push(t - last);
  last = t;
  if (!ctx) return;
  const t0 = performance.now();
  const w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.reset();
  ctx.scale(dpr, dpr);
  const n = images.length;
  for (let i = 0; i < n; i++) {
    const img = images[i], s = sizes[i];
    if (!img || !s) continue;
    const x = (0.5 + 0.5 * Math.sin(t / 900 + i * 1.7)) * Math.max(0, w - s[0]);
    const y = (0.5 + 0.5 * Math.cos(t / 1100 + i * 2.3)) * Math.max(0, h - s[1]);
    try { ctx.drawElementImage(img, x, y, s[0], s[1]); } catch {}
  }
  drawMs += performance.now() - t0; drawN++;
}
