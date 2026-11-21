// stage-2d.js: small helpers shared by the caption and timing pages.
//
//   import { fit, blobUrl, quietStage, hitAt, sleep, until } from '/lib/stage-2d.js';
//
//   fit(canvas);                       // backing store in device pixels, requestPaint() on resize
//   const url = await blobUrl('/media/talk.webm');   // a URL that can always be seeked
//   const stage = quietStage();        // the shared check fixture box, letting taps through
//   hitAt(x, y);                       // elementFromPoint() with the fixture box hittable for the call

import { testStage } from '/shared/support.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `test` until it returns something truthy, or throw `what` after `ms`. */
export async function until(test, ms = 4000, what = 'the wait timed out') {
  const end = performance.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (performance.now() > end) throw new Error(what);
    await sleep(40);
  }
}

/** Size the canvas buffer in device pixels and ask for a paint when the size changes. Returns the observer. */
export function fit(canvas) {
  const ro = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    const w = box ? box.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio);
    const h = box ? box.blockSize : Math.round(entry.contentRect.height * devicePixelRatio);
    if (!w || !h) return;
    // Assigning width or height clears the canvas, so assign only on a change.
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.requestPaint?.();
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  return ro;
}

const blobs = new Map();
/** Fetch a media file once and hand back a blob URL. A blob URL can be seeked whatever the server does with Range requests. */
export function blobUrl(url) {
  if (!blobs.has(url)) blobs.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.blob(); }).then((b) => URL.createObjectURL(b)));
  return blobs.get(url);
}

/** The check fixture box. It lies over the bottom left of the window while checks run, so it lets taps through. */
export function quietStage() {
  const stage = testStage();
  stage.style.pointerEvents = 'none';
  return stage;
}

/** document.elementFromPoint() with the fixture box able to take hits for the length of the call. */
export function hitAt(x, y) {
  const stage = quietStage();
  stage.style.pointerEvents = 'auto';
  try { return document.elementFromPoint(x, y); } finally { stage.style.pointerEvents = 'none'; }
}

/** Stop a media element and give its decoder back. */
export function release(media) {
  try { media.pause(); media.srcObject = null; media.removeAttribute('src'); media.load(); } catch { /* already gone */ }
}
