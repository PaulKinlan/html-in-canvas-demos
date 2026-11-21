import { mount, put, park, back, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('toastCanvas');
  const app = document.getElementById('toastApp');
  const form = document.getElementById('toastForm');
  const list = document.getElementById('toastNotes');
  const out = document.getElementById('toastOut');
  const toasts = [];

  // #region toasts
  // A toast is a non-modal <dialog open> that is a drawable child of the canvas. It is not in the top
  // layer, so the canvas can draw it: sliding in, stacked, and fading out. Its buttons are real buttons.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const k = Math.min(1, (w - 24) / app.offsetWidth);
    ctx.save(); ctx.translate((w - app.offsetWidth * k) / 2, 12); ctx.scale(k, k); put(ctx, app, 0, 0); ctx.restore();
    let y = h - 10, moving = false;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const toast = toasts[i], el = toast.el;
      const enter = clamp((t - toast.born) / 420), leave = toast.gone ? clamp((t - toast.gone) / 260) : 0;
      if (leave >= 1) { park(canvas, el); el.remove(); toasts.splice(i, 1); moving = true; continue; }
      y -= (el.offsetHeight + 8) * (1 - leave);
      // Each toast eases towards its place in the stack.
      toast.y = toast.y === undefined ? y : toast.y + (y - toast.y) * 0.22;
      if (enter < 1 || leave > 0 || Math.abs(toast.y - y) > 0.5) moving = true; else toast.y = y;
      const x = w - el.offsetWidth - 12 + (1 - back(enter)) * (el.offsetWidth + 30) + leave * 40;
      ctx.save();
      ctx.globalAlpha = 1 - leave;
      put(ctx, el, x, toast.y);
      ctx.restore();
    }
    return moving;
  });
  const dismiss = (toast) => { if (!toast.gone) { toast.gone = performance.now(); toast.el.inert = true; stage.request(); } };
  function toast(text, undo) {
    const el = document.createElement('dialog');
    el.className = 'toast';
    el.setAttribute('drawable', '');
    el.open = true;
    el.innerHTML = '<span></span><button type="button" value="undo">Undo</button><button type="button" value="close" aria-label="Dismiss">×</button>';
    el.firstChild.textContent = text;
    const entry = { el, born: performance.now() };
    el.addEventListener('click', (e) => {
      const what = e.target.closest('button')?.value;
      if (what === 'undo') { undo(); out.textContent = `Undo pressed on the toast: ${text}. ${list.children.length} notes are left.`; }
      if (what) dismiss(entry);
    });
    canvas.append(el);
    toasts.push(entry);
    while (toasts.filter((x) => !x.gone).length > 3) dismiss(toasts.find((x) => !x.gone));
    stage.request();
  }
  // #endregion toasts

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const field = form.elements.note, text = field.value.trim() || `Note ${list.children.length + 1}`;
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
    while (list.children.length > 4) list.firstElementChild.remove();
    field.value = '';
    toast(`Saved "${text}"`, () => item.remove());
    out.textContent = `Saved. ${toasts.filter((x) => !x.gone).length} toasts are open, each a <dialog open> drawn by the canvas.`;
  });
  out.textContent = 'Press Save a few times, then Undo or the cross on a toast.';
  return { stage };
}
