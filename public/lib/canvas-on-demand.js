// canvas-on-demand.js: draw an element in a canvas all the time, or only for as long as a transition lasts.
// Used by /canvas-on-demand/. The transition is the sweep from theme-sweep.js, made from two pictures of the element.
//
//   const shown = keep(canvas, el);                  el is a child of a drawable canvas. Draw it on every paint event.
//   const result = await shown.sweep(change, ms);    copy the old look, call change(), copy the new look, sweep between them
//   shown.stop();
//
//   const { canvas, shown } = wrap(el, { standIn }); make a canvas where el is, and move el into it
//   unwrap(el, canvas, shown);                       move el back out and free the canvas
import { sweepFront, sweep2d } from './theme-sweep.js';

export const supported = typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

// #region keep
export function keep(canvas, el, onFirstDraw) {
  const ctx = canvas.getContext('2d'), atlas = document.createElement('canvas'), pictures = atlas.getContext('2d');
  let job = null, drawn = false, queued = 0, stopped = false, tries = 0;
  const size = () => {
    const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
    if (w && canvas.width !== w) canvas.width = w;               // assigning a size clears the canvas, so only when it changed
    if (h && canvas.height !== h) canvas.height = h;
  };
  const again = () => { if (!queued && !stopped) queued = requestAnimationFrame(() => { queued = 0; canvas.requestPaint?.(); }); };
  const start = () => { const k = canvas.width / canvas.clientWidth || 1; ctx.reset(); ctx.scale(k, k); };
  const draw = () => {
    start();
    try { ctx.drawElementImage(el, 0, 0, el.offsetWidth, el.offsetHeight); } catch { return false; }   // no picture yet
    if (!drawn) { drawn = true; onFirstDraw?.(); }
    return true;
  };
  function paint() {
    if (stopped || !canvas.clientWidth) return;
    const now = performance.now(), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!job) { if (!draw() && tries++ < 120) again(); return; }
    if (job.phase === 'old') {                                   // the element as it is now, copied to the top half
      if (!draw()) return again();
      if (atlas.width !== canvas.width || atlas.height !== canvas.height * 2) { atlas.width = canvas.width; atlas.height = canvas.height * 2; }
      pictures.clearRect(0, 0, atlas.width, atlas.height);
      pictures.drawImage(canvas, 0, 0);
      job.change();                                              // the browser will lay it out and paint it again
      job.phase = 'new';
      return again();
    }
    if (job.phase === 'new') {                                   // the element after the change, copied to the bottom half
      if (!draw()) return again();
      pictures.drawImage(canvas, 0, canvas.height);
      Object.assign(job, { phase: 'sweep', began: now, last: now, first: now - job.since });
      job.onFirstFrame?.();
    }
    const t = (now - job.began) / job.ms;
    if (t >= 1) {
      draw();
      const done = job; job = null;
      atlas.width = atlas.height = 0;                            // give the two pictures back
      return done.resolve({ first: done.first, paints: done.paints, ms: now - done.began, gap: done.gap });
    }
    job.paints++; job.gap = Math.max(job.gap, now - job.last); job.last = now;
    start();
    sweep2d(ctx, atlas, w, h, sweepFront(t * t * (3 - 2 * t), w, h));   // no element is drawn in these frames
    again();
  }
  canvas.addEventListener('paint', paint);
  const watch = new ResizeObserver(() => { size(); canvas.requestPaint?.(); });
  watch.observe(canvas);
  size();
  canvas.requestPaint?.();
  return {
    get busy() { return !!job; },
    sweep(change, ms = 900, { since = performance.now(), onFirstFrame } = {}) {
      if (job) return Promise.reject(new Error('A sweep is already running.'));
      return new Promise((resolve) => { job = { phase: 'old', change, ms, since, onFirstFrame, resolve, paints: 0, gap: 0 }; canvas.requestPaint?.(); });
    },
    stop() { stopped = true; watch.disconnect(); canvas.removeEventListener('paint', paint); cancelAnimationFrame(queued); atlas.width = atlas.height = 0; },
  };
}
// #endregion keep

// #region wrap
// Make a drawable canvas of the element's size in the element's place, and move the element into it.
// The canvas is empty until its first paint event. With standIn, a lifeless copy of the element sits behind
// the canvas until then, so the swap can't be seen. The element's parent needs position: relative and isolation: isolate.
export function wrap(el, { standIn = true } = {}) {
  const host = el.parentNode, w = el.offsetWidth, h = el.offsetHeight, canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.style.cssText = `display:block;width:${w}px;height:${h}px`;
  canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
  let copy = null;
  if (standIn) {
    copy = el.cloneNode(true);
    const fields = el.querySelectorAll('input, textarea, select');
    copy.querySelectorAll('input, textarea, select').forEach((f, i) => { f.value = fields[i].value; f.checked = fields[i].checked; });
    copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    copy.removeAttribute('id');
    copy.inert = true; copy.setAttribute('aria-hidden', 'true');
    copy.style.cssText += ';position:absolute;left:0;top:0;z-index:-1;margin:0';
    host.append(copy);
  }
  host.insertBefore(canvas, el);
  el.setAttribute('drawable', '');
  move(canvas, el, null);
  const shown = keep(canvas, el, () => copy?.remove());
  return { canvas, shown, copy };
}
export function unwrap(el, canvas, shown) {
  shown.stop();
  move(canvas.parentNode, el, canvas);
  el.removeAttribute('drawable');
  canvas.remove();
  window.__gfx?.retire?.(canvas);                                // the site's guard frees a canvas that was removed
}
// moveBefore() keeps focus, a caret and a running animation. insertBefore() takes the element out and puts it back.
function move(parent, el, before) {
  try { if (parent.moveBefore) return parent.moveBefore(el, before); } catch {}
  parent.insertBefore(el, before);
}
// #endregion wrap
