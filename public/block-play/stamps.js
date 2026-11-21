import { mount, put, clamp, back } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('stampsCanvas'), template = document.getElementById('stampsTemplate'), out = document.getElementById('stampsOut');
  const count = document.getElementById('stampsCount');
  let tickets = [], layout = 'ring', from = [], now = [], t0 = -1e9, taps = 0;
  const rnd = (i, n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); };
  // #region stamps
  // One <template> holds a ticket. It is cloned once for each ticket, and every clone is a drawable
  // child of the canvas with its own number, colour and tap count. A layout gives each clone a place,
  // a turn and a size, and the clones move between layouts one after another.
  const layouts = {
    ring: (i, n, w, h) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2, R = Math.min(w, h) * 0.34; return { x: w / 2 + Math.cos(a) * R, y: h / 2 + Math.sin(a) * R, r: a + Math.PI / 2, s: n > 12 ? 0.7 : 0.9 }; },
    fan: (i, n, w, h) => { const a = n > 1 ? (i / (n - 1) - 0.5) * 2.2 : 0, R = Math.min(h * 0.62, (w / 2 - 44) / Math.sin(1.1)); return { x: w / 2 + Math.sin(a) * R, y: h / 2 + R * 0.7 - Math.cos(a) * R, r: a, s: 1 }; },
    grid: (i, n, w, h) => { const rows = Math.ceil(n / 3), s = Math.min(1, (h - 16) / (rows * 64), (w - 12) / 318); return { x: w / 2 + ((i % 3) - 1) * 106 * s, y: h / 2 + (Math.floor(i / 3) - (rows - 1) / 2) * 64 * s, r: 0, s }; },
    pile: (i, n, w, h) => ({ x: w / 2 + (rnd(i, 1) - 0.5) * w * 0.45, y: h / 2 + (rnd(i, 2) - 0.5) * h * 0.45, r: (rnd(i, 3) - 0.5) * 2.4, s: 1 }),
  };
  function fill() {
    const n = Number(count.value);
    while (tickets.length < n) {
      const el = template.content.firstElementChild.cloneNode(true), i = tickets.length;
      el.querySelector('.no').textContent = String(i + 1).padStart(3, '0');
      el.style.setProperty('--h', String((i * 47) % 360));
      el.setAttribute('aria-label', `Ticket ${i + 1}`);
      canvas.append(el); tickets.push(el);
    }
    while (tickets.length > n) tickets.pop().remove();
  }
  const stage = mount(canvas, (ctx, w, h, t) => {
    const n = tickets.length, tw = tickets[0].offsetWidth, th = tickets[0].offsetHeight;
    now = tickets.map((el, i) => {
      const b = layouts[layout](i, n, w, h), a = from[i] ?? { x: w / 2, y: h / 2, r: 0, s: 0 }, u = back(clamp((t - t0 - i * 28) / 520));
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, r: a.r + (b.r - a.r) * u, s: a.s + (b.s - a.s) * u };
    });
    tickets.forEach((el, i) => {
      const p = now[i];
      if (p.s <= 0.01) return;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(p.s, p.s);
      put(ctx, el, -tw / 2, -th / 2);
      ctx.restore();
    });
    out.textContent = `${n} clones of one template, layout "${layout}". Taps counted on the clones: ${taps}.`;
    return t - t0 < 520 + n * 28;
  });
  // #endregion stamps
  const go = () => { from = now.map((p) => ({ ...p })); fill(); t0 = performance.now(); stage.request(); };
  count.addEventListener('input', go);
  document.getElementById('stampsLayouts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layout]');
    if (!b) return;
    layout = b.dataset.layout;
    for (const x of b.parentNode.children) x.setAttribute('aria-pressed', String(x === b));
    go();
  });
  canvas.addEventListener('click', (e) => {
    const el = e.target.closest('.ticket');
    if (!el) return;
    const i = el.querySelector('i'); i.textContent = String(Number(i.textContent) + 1); taps++;
    stage.request();
  });
  fill(); t0 = performance.now();
  return { stage };
}
