// Helpers for a view transition that is scoped to a canvas and drawn by the canvas.
//
// The page needs this CSS (see index.html, region "css-clock"):
//   @property --vt-p { syntax: "<number>"; inherits: false; initial-value: 0; }
//   @keyframes vt-clock { from { --vt-p: 0; } to { --vt-p: 1; } }
//   .vt-canvas { view-transition-name: none; view-transition-scope: all; }
//   .vt-canvas::view-transition-group(*) { animation: vt-clock 900ms ease both; }
//
// "none" stops the canvas taking part in its own transition, which would blank it.
// "scope: all" keeps a transition on an ancestor from taking the names inside the canvas.

export const scoped = typeof Element !== 'undefined' && 'startViewTransition' in Element.prototype;

// #region clock
/** 0 to 1 for one named element, read from the animation the browser runs on its hidden group. */
export function clock(scope, name) {
  const v = getComputedStyle(scope, `::view-transition-group(${name})`).getPropertyValue('--vt-p');
  return v === '' ? 0 : Number(v);
}
// #endregion clock

// #region boxes
/** Layout boxes of the named elements, relative to their offset parent (the drawable wrapper). */
export function boxesOf(items) {
  return new Map(items.map((el) => [el, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }]));
}
// #endregion boxes

// #region run
/**
 * Start a transition on `scope`, keep `state.active` true while it runs and ask `canvases` to paint every frame.
 * Returns the ViewTransition, or null when the browser has no element.startViewTransition (the update still runs).
 */
export function run(scope, update, state, canvases = [scope]) {
  if (!scoped) { update(); for (const c of canvases) c.requestPaint?.(); return null; }
  const vt = scope.startViewTransition(update);
  state.active = vt;
  const tick = () => {
    if (state.active !== vt) return;
    for (const c of canvases) c.requestPaint?.();
    requestAnimationFrame(tick);
  };
  tick();
  vt.finished.catch(() => {}).then(() => {
    if (state.active === vt) state.active = null;
    for (const c of canvases) c.requestPaint?.();
  });
  return vt;
}
// #endregion run

/** Size a canvas's backing store to its box. Assigns width and height only when they change. */
export function fit(canvas, onChange) {
  const apply = () => {
    const dpr = devicePixelRatio * (canvas.currentCSSZoom || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    onChange?.();
    canvas.requestPaint?.();
  };
  new ResizeObserver(apply).observe(canvas);
  apply();
}

/** Say what happened to a transition in a status line. */
export async function report(vt, el, label = 'Transition') {
  if (!vt) { el.textContent = 'element.startViewTransition() is not available here. The change was made without a transition.'; return; }
  try {
    await vt.ready;
    el.textContent = `${label} running.`;
    await vt.finished;
    el.textContent = `${label} finished.`;
  } catch (err) {
    el.textContent = `${label} did not run: ${err.message}`;
  }
}
