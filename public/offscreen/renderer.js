// Worker renderer for <canvas-slot worker="./renderer.js">.
// Owns the OffscreenCanvas and keeps the latest ElementImage per slot name.
// Animates with the worker's own requestAnimationFrame, so it keeps moving
// while the main thread is blocked (the DOM snapshots just stop updating).

let canvas, ctx;
let dpr = 1;
const images = new Map(); // name -> ElementImage
const sizes = new Map(); // name -> {width, height}
let frames = 0;
let lastReport = performance.now();

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    canvas = data.canvas;
    ctx = canvas.getContext('2d');
    requestAnimationFrame(frame);
  } else if (data.type === 'resize') {
    canvas.width = data.width;
    canvas.height = data.height;
    dpr = data.dpr;
  } else if (data.type === 'paint') {
    for (const [name, img] of Object.entries(data.images)) {
      images.get(name)?.close();
      images.set(name, img);
    }
    for (const [name, size] of Object.entries(data.sizes)) sizes.set(name, size);
  }
};

function frame(t) {
  requestAnimationFrame(frame);
  if (!ctx) return;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.reset();
  ctx.scale(dpr, dpr);

  // Orbit the slotted cards around the centre, scaling by depth.
  const entries = [...images.entries()];
  const n = entries.length;
  const order = entries
    .map(([name, img], i) => {
      const a = t / 2400 + (i / n) * Math.PI * 2;
      return { name, img, a, depth: (Math.sin(a) + 1) / 2 };
    })
    .sort((p, q) => p.depth - q.depth);

  for (const { name, img, a, depth } of order) {
    const s = sizes.get(name);
    if (!s) continue;
    const scale = 0.7 + depth * 0.4;
    const cx = w / 2 + Math.cos(a) * (w / 2 - s.width / 2 - 20) * 0.9;
    const cy = h / 2 + Math.sin(a) * 30 - s.height / 2 * scale;
    ctx.save();
    ctx.globalAlpha = 0.55 + depth * 0.45;
    ctx.translate(cx, cy + (s.height * scale) / 2);
    ctx.scale(scale, scale);
    ctx.translate(-s.width / 2, -s.height / 2);
    try {
      // Drawing in a worker also updates the element's geometry on the main
      // thread (batched, fires 'elementgeometryupdate'), so clicks still land.
      ctx.drawElementImage(img, 0, 0, s.width, s.height);
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
    ctx.restore();
  }

  frames++;
  if (t - lastReport > 500) {
    self.postMessage({ type: 'fps', fps: Math.round((frames * 1000) / (t - lastReport)) });
    frames = 0;
    lastReport = t;
  }
}
