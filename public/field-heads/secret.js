import { mount, put, place, colors } from '/form-state/kit.js';
import { piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('secretCanvas'), form = document.getElementById('secretForm'), out = document.getElementById('secretOut');
  const field = form.elements.pass, show = document.getElementById('secretShow');
  // #region secret
  // The form is drawn twice: once where it is used, and once small in a frame that stands for what a
  // person on the other end of a screen share would get. While the field is type="password" the picture
  // of it holds dots and nothing else, so the copy needs no care. When the box is ticked the field
  // becomes type="text" and the picture holds the characters. The canvas knows from the type, and draws
  // that one field of the copy through a blur.
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), fw = form.offsetWidth, fh = form.offsetHeight, k = Math.min(1, (w - 24) / fw), open = field.type !== 'password';
    const s = 0.62 * k, vx = (w - fw * s) / 2, vy = 40;
    // The window of the person watching.
    ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.roundRect(vx - 12, vy - 30, fw * s + 24, fh * s + 44, 10); ctx.fill();
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(vx + 2, vy - 15, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('What a viewer of the shared screen gets', vx + 14, vy - 14);
    ctx.fillStyle = c.card; ctx.fillRect(vx, vy, fw * s, fh * s);
    ctx.save();
    ctx.translate(vx, vy); ctx.scale(s, s);
    if (!open) put(ctx, form, 0, 0);
    else {
      // Everything but the field, then the field alone through the blur.
      const b = { x: field.offsetLeft, y: field.offsetTop, w: field.offsetWidth, h: field.offsetHeight };
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, fw, fh); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip('evenodd'); put(ctx, form, 0, 0); ctx.restore();
      ctx.filter = 'blur(7px)'; piece(ctx, form, b.x + 2, b.y + 2, b.w - 4, b.h - 4); ctx.filter = 'none';
      ctx.strokeStyle = c.bad; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    ctx.restore();
    // The form itself, last, so that input goes to it here.
    const fy = vy + fh * s + 34;
    ctx.save(); ctx.translate((w - fw * k) / 2, fy); ctx.scale(k, k); put(ctx, form, 0, 0); place(ctx, form, 0, 0); ctx.restore();
    out.textContent = open
      ? `The field is type="text": its picture holds the ${field.value.length} characters. The copy draws that field through a blur.`
      : `The field is type="password": its picture holds ${field.value.length} dots and no characters. The copy is drawn as it is.`;
    return false;
  });
  // #endregion secret
  show.addEventListener('change', () => { field.type = show.checked ? 'text' : 'password'; stage.request(); });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => stage.request());
  return { stage };
}
