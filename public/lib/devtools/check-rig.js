// A small drawable canvas for live checks. It sits on the shared test stage, a
// fixed box in the corner of the window, so a check never touches the demo.
import { testStage } from '/shared/support.js';

/**
 * Build a canvas of `width` x `height` CSS px (one buffer pixel per CSS pixel)
 * with `html` as its children, each marked drawable. `paint(draw)` asks for a
 * paint event and calls draw(ctx, event) inside it after ctx.reset().
 * `hits: true` lets elementFromPoint() see the fixture.
 */
export function rig(html, { width = 320, height = 200, hits = false } = {}) {
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.width = width;
  c.height = height;
  c.style.cssText = `flex:none;position:relative;width:${width}px;height:${height}px`;
  c.innerHTML = html;
  for (const el of c.children) el.setAttribute('drawable', '');
  const stage = testStage();
  stage.style.pointerEvents = hits ? 'auto' : 'none';
  stage.append(c);
  const g = c.getContext('2d', { willReadFrequently: true });
  const paint = (draw) => new Promise((resolve, reject) => {
    c.addEventListener('paint', (event) => {
      try { g.reset(); draw(g, event); resolve(event); } catch (err) { reject(err); }
    }, { once: true });
    c.requestPaint();
  });
  return { c, g, paint, kids: [...c.children], box: () => c.getBoundingClientRect() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The box of pixels that match `test(r, g, b, a)`, in canvas px, or null. */
export function pixelBox(g, test = (r, gr, b, a) => a > 60) {
  const { width, height } = g.canvas, d = g.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (!test(d[i], d[i + 1], d[i + 2], d[i + 3])) continue;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}
