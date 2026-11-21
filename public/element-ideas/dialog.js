import { mount, put, colors, back, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('dialogCanvas');
  const page = document.getElementById('dialogPage');
  const dialog = document.getElementById('dialogBox');
  const opener = document.getElementById('dialogOpen');
  const out = document.getElementById('dialogOut');
  let open = 0, cancel = null, origin = { x: 0, y: 0 };

  // #region dialog
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const x0 = Math.round((w - page.offsetWidth) / 2), y0 = 12;
    // The page behind. While the dialog is open the canvas blurs and dims this one picture.
    ctx.save();
    if (open > 0) ctx.filter = `blur(${5 * open}px) grayscale(${open}) brightness(${1 - 0.25 * open})`;
    put(ctx, page, x0, y0);
    ctx.restore();
    if (open <= 0 || !dialog.open) return false;
    // The backdrop is drawn by the canvas: rings that spread from the button that opened the dialog.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const r = ((t / 40 + i * 60) % 360) * open;
      ctx.globalAlpha = 0.35 * open * (1 - r / 360);
      ctx.beginPath(); ctx.arc(origin.x, origin.y, r, 0, 7); ctx.stroke();
    }
    ctx.restore();
    // dialog.show() keeps the dialog in the canvas. showModal() would move it to the top layer, outside the canvas.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const s = 0.8 + 0.2 * back(open);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.min(1, open * 1.5);
    put(ctx, dialog, -dialog.offsetWidth / 2, -dialog.offsetHeight / 2);
    ctx.restore();
    return true;
  });
  // #endregion dialog

  const count = () => page.querySelectorAll('input:checked').length;
  const fade = (to, done) => { const from = open; cancel?.(); cancel = tween(280, (p) => { open = from + (to - from) * p; stage.request(); }, done); };
  opener.addEventListener('click', () => {
    if (!count()) { out.textContent = 'Tick a file first.'; return; }
    const b = opener.getBoundingClientRect(), cb = canvas.getBoundingClientRect();
    origin = { x: b.x + b.width / 2 - cb.x, y: b.y + b.height / 2 - cb.y };
    dialog.querySelector('h3').textContent = `Delete ${count()} file${count() === 1 ? '' : 's'}?`;
    // A dialog opened with show() is not modal, so the page sets inert on what is behind it.
    page.inert = true;
    dialog.show();
    fade(1);
  });
  function close(value) {
    if (!dialog.open) return;
    fade(0, () => {
      dialog.close(value);
      page.inert = false;
      if (value === 'delete') page.querySelectorAll('input:checked').forEach((box) => box.closest('li').remove());
      out.textContent = `dialog.returnValue is "${dialog.returnValue}".`;
      opener.focus({ preventScroll: true });
      stage.request();
    });
  }
  dialog.addEventListener('submit', (e) => { e.preventDefault(); close(e.submitter?.value ?? 'cancel'); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') close('cancel'); });
  canvas.addEventListener('click', (e) => { if (e.target === canvas) close('cancel'); });
  page.addEventListener('change', stage.request);
}
