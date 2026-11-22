import { mount, put, colors, clamp } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('ringCanvas'), input = document.getElementById('ringInput'), out = document.getElementById('ringOut');
  // #region ring
  // The suggestions are the <option> elements of the input's <datalist>, read through input.list. The
  // browser's own list of them is a window of its own and is never in the canvas, so the canvas draws
  // them: chips on a ring round the field. A chip that matches what is typed grows and comes closer,
  // and the others fade. With the ring drawn, the list attribute is taken off, which is the only way to
  // stop the browser's own list from opening over it.
  const options = [...input.list.options].map((o) => o.value);
  const listId = input.getAttribute('list');
  input.removeAttribute('list');
  addEventListener('form-state-plain', () => input.setAttribute('list', listId));
  const chips = options.map((value, i) => ({ value, i, on: 1, x: 0, y: 0, w: 0, h: 30 }));
  let last = 0, picked = '';
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - last) / 1000); last = t;
    const typed = input.value.trim().toLowerCase(), iw = input.offsetWidth, ih = input.offsetHeight, k = Math.min(1, (w - 150) / iw);
    const cx = w / 2, cy = h / 2;
    let moving = false;
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const chip of chips) {
      const match = !typed || chip.value.toLowerCase().includes(typed), aim = match ? 1 : 0;
      if (chip.on !== aim) { chip.on = aim > chip.on ? Math.min(aim, chip.on + dt / 0.25) : Math.max(aim, chip.on - dt / 0.25); moving = true; }
      const a = (chip.i / chips.length) * Math.PI * 2 - Math.PI / 2, near = typed && match ? 0.82 : 1;
      const rx = Math.min(w / 2 - 44, 150) * (near + 0.12 * (1 - chip.on)), ry = (h / 2 - 28) * (near + 0.12 * (1 - chip.on));
      chip.w = ctx.measureText(chip.value).width + 22;
      chip.x = clamp(cx + Math.cos(a) * rx, chip.w / 2 + 4, w - chip.w / 2 - 4); chip.y = cy + Math.sin(a) * ry;
      const s = 0.8 + 0.3 * chip.on * (typed && match ? 1.15 : 1);
      ctx.save();
      ctx.translate(chip.x, chip.y); ctx.scale(s, s); ctx.globalAlpha = 0.22 + 0.78 * chip.on;
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((cx - chip.x) / s * 0.35, (cy - chip.y) / s * 0.35); ctx.stroke();
      ctx.fillStyle = chip.value === picked ? c.accent : c.bg; ctx.strokeStyle = typed && match ? c.accent : c.line; ctx.lineWidth = typed && match ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(-chip.w / 2, -chip.h / 2, chip.w, chip.h, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = chip.value === picked ? '#fff' : c.fg; ctx.fillText(chip.value, 0, 1);
      ctx.restore();
    }
    ctx.save(); ctx.translate(cx - iw * k / 2, cy - ih * k / 2); ctx.scale(k, k); put(ctx, input, 0, 0); ctx.restore();
    const n = chips.filter((x) => !typed || x.value.toLowerCase().includes(typed)).length;
    out.textContent = `${options.length} options read from input.list. ${typed ? `${n} match "${input.value.trim()}".` : 'Nothing typed.'} input.list is now ${input.list === null ? 'null' : 'the datalist'}.`;
    return moving;
  });
  // The chips are canvas drawing, so a tap on one is a tap on the canvas at a place inside its shape.
  canvas.addEventListener('click', (e) => {
    if (e.target !== canvas) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const chip = chips.find((p) => p.on > 0.5 && Math.abs(x - p.x) < p.w / 2 + 4 && Math.abs(y - p.y) < p.h / 2 + 6);
    if (!chip) return;
    picked = chip.value; input.value = chip.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // #endregion ring
  input.addEventListener('input', () => { if (input.value !== picked) picked = ''; last = performance.now(); stage.request(); });
  return { stage };
}
