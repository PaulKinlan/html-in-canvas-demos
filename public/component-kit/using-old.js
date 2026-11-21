// The same function as using.js without the `using` declaration.

// #region old-using
export function drawEcho(ctx, canvas, el, copies, log = []) {
  const image = canvas.captureElementImage(el);
  try {
    log.push(image);
    if (copies <= 0) return 0;
    for (let i = 1; i <= copies; i++) {
      ctx.globalAlpha = 0.5 / i;
      ctx.drawElementImage(image, 0, i * 10, el.offsetWidth, el.offsetHeight);
    }
    ctx.globalAlpha = 1;
    return copies;
  } finally {
    image.close();
  }
}
// #endregion old-using
