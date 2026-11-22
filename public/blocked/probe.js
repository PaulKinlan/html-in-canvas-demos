// Helpers shared by the demos of /blocked/: one pixel read from a copy of a canvas, and the route lists.

// #region copy
// Pixels are read from a drawImage() copy in a plain 2D canvas, never from the drawable canvas itself,
// and only after a tap. at(x, y) takes CSS pixels of the source canvas.
export function copyOf(canvas) {
  const k = document.createElement('canvas');
  k.width = canvas.width; k.height = canvas.height;
  const q = k.getContext('2d', { willReadFrequently: true });
  q.drawImage(canvas, 0, 0);
  const s = canvas.width / canvas.clientWidth || 1;
  return {
    at: (x, y) => q.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data,
    done: () => { k.width = k.height = 0; },
  };
}
// #endregion copy

export const near = (p, rgb, tol = 36) => p[3] > 200 && Math.abs(p[0] - rgb[0]) < tol && Math.abs(p[1] - rgb[1]) < tol && Math.abs(p[2] - rgb[2]) < tol;
export const frames = (n = 2) => new Promise((r) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : r()); step(); });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Write the result of one route. state is "works", "blocked" or "unknown".
export function route(id, text, state = 'unknown') {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.textContent = text;
  dd.dataset.state = state;
}

// The second origin this copy of the site can load pictures from. Both live hosts serve the same files
// with Access-Control-Allow-Origin: *.
export function otherOrigin() {
  const u = new URL(location.href);
  if (u.hostname === 'localhost') { u.hostname = '127.0.0.1'; return u.origin; }
  if (u.hostname === '127.0.0.1') { u.hostname = 'localhost'; return u.origin; }
  return u.hostname === 'html-in-canvas.page' ? 'https://html-in-canvas-demos.kinlan-test.workers.dev' : 'https://html-in-canvas.page';
}
