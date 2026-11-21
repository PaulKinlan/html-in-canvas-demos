// Latency worker for /perf/: owns the OffscreenCanvas, draws each ElementImage
// it is sent on its next animation frame, and says when it did.
let canvas, ctx, pending = null;
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    canvas = data.canvas;
    ctx = canvas.getContext('2d');
  } else if (data.type === 'image') {
    pending?.image.close();
    pending = data;
    requestAnimationFrame(() => {
      if (!pending) return;
      const { image, id, width, height } = pending;
      pending = null;
      ctx.reset();
      try { ctx.drawElementImage(image, 0, 0, width, height); } catch {}
      image.close();
      // Epoch milliseconds, so the page can compare with its own clock.
      self.postMessage({ type: 'drawn', id, at: performance.timeOrigin + performance.now() });
    });
  }
};
