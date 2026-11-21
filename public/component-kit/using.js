// The `using` declaration is new syntax: a browser without it cannot parse
// this file at all. So it lives in its own module, and the page imports it
// only after checking that the syntax is there.

/** Make an ElementImage disposable. It has close() but no [Symbol.dispose]. */
export const closing = (image) => ({ image, [Symbol.dispose]: () => image.close() });

// #region new-using
/**
 * Draw `copies` faint copies of an element under itself, from one snapshot.
 * The snapshot is closed when the block is left: at the end, at the early
 * return, or when drawElementImage() throws.
 */
export function drawEcho(ctx, canvas, el, copies, log = []) {
  using snap = closing(canvas.captureElementImage(el));
  log.push(snap.image);
  if (copies <= 0) return 0;
  for (let i = 1; i <= copies; i++) {
    ctx.globalAlpha = 0.5 / i;
    ctx.drawElementImage(snap.image, 0, i * 10, el.offsetWidth, el.offsetHeight);
  }
  ctx.globalAlpha = 1;
  return copies;
}
// #endregion new-using
