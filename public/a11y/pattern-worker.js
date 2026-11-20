// Minimal renderer for <canvas-slot worker>: draws each snapshot it is sent,
// slightly tilted, on the OffscreenCanvas. Used by /a11y/pattern.html?p=worker.
let canvas, ctx, dpr = 1, dirty = true;
const images = new Map(), sizes = new Map();

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    canvas = data.canvas;
    ctx = canvas.getContext('2d');
    requestAnimationFrame(frame);
  } else if (data.type === 'resize') {
    canvas.width = data.width; canvas.height = data.height; dpr = data.dpr;
  } else if (data.type === 'paint') {
    for (const [name, img] of Object.entries(data.images)) { images.get(name)?.close(); images.set(name, img); }
    for (const [name, size] of Object.entries(data.sizes)) sizes.set(name, size);
  }
  dirty = true;
};

function frame() {
  requestAnimationFrame(frame);
  if (!ctx || !dirty) return;
  dirty = false;
  ctx.reset();
  ctx.scale(dpr, dpr);
  ctx.translate(24, 20);
  ctx.rotate(-0.03);
  for (const [name, img] of images) {
    const s = sizes.get(name);
    if (!s) continue;
    try { ctx.drawElementImage(img, 0, 0, s.width, s.height); } catch { dirty = true; }
  }
}
