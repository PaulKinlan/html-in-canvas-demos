import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('styleCanvas');
  const sheet = document.getElementById('styleSheet');
  const preview = document.getElementById('stylePreview');
  const out = document.getElementById('styleOut');
  let changed = 0;

  // #region style
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const x0 = Math.round((w - sheet.offsetWidth) / 2);
    put(ctx, preview, Math.round((w - preview.offsetWidth) / 2), 10);
    // The <style> element has display: block and contenteditable, so it is drawn and typed into like any text box.
    const y0 = 10 + preview.offsetHeight + 10;
    put(ctx, sheet, x0, y0);
    const age = (t - changed) / 500;
    if (age < 1) {
      ctx.strokeStyle = c.accent; ctx.lineWidth = 3; ctx.globalAlpha = 1 - age;
      ctx.strokeRect(x0 - 3, y0 - 3, sheet.offsetWidth + 6, sheet.offsetHeight + 6);
      return true;
    }
    return false;
  });
  // #endregion style

  const report = () => {
    const rules = sheet.sheet?.cssRules.length ?? 0;
    out.textContent = `The style sheet parses to ${rules} rule${rules === 1 ? '' : 's'}.`;
  };
  sheet.addEventListener('input', () => { changed = performance.now(); report(); stage.request(); });
  report();
}
