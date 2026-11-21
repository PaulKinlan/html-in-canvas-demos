import { mount, put, place, fresh } from './kit.js';

export default function start() {
  const canvas = document.getElementById('pixelCanvas');
  const form = document.getElementById('pixelForm');
  const out = document.getElementById('pixelOut');
  const N = 16, CELL = 16, SIZE = N * CELL;

  // #region pixel-form
  // The picture is 256 checkboxes with the same name in one form. A checked box is a dark pixel.
  const ART = [
    '................', '................', '...###....###...', '..#####..#####..', '.##############.', '.##############.',
    '.##############.', '.##############.', '..############..', '...##########...', '....########....', '.....######.....',
    '......####......', '.......##.......', '................', '................',
  ];
  for (let i = 0; i < N * N; i++) {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.name = 'p'; box.value = i;
    box.defaultChecked = ART[i >> 4][i & 15] === '#';
    box.setAttribute('aria-label', `Row ${(i >> 4) + 1}, column ${(i & 15) + 1}`);
    form.append(box);
  }
  const boxes = [...form.elements.p];
  // The value of the picture is the form's value: the list of checked boxes, as FormData gives it.
  const value = () => new Set(new FormData(form).getAll('p').map(Number));
  const hex = (set) => { let s = ''; for (let i = 0; i < N * N; i += 4) s += ((set.has(i) ? 8 : 0) | (set.has(i + 1) ? 4 : 0) | (set.has(i + 2) ? 2 : 0) | (set.has(i + 3) ? 1 : 0)).toString(16); return s; };
  // #endregion pixel-form

  // #region pixel-draw
  // The paint handler has no listener on the boxes. A box that changes raises `paint`, and the handler
  // reads FormData, compares it with the last value and starts a ring on each pixel that changed.
  // The form is drawn once at full size, as the editor, and again at 1/4 size across the whole canvas.
  let before = null, paints = 0;
  const pops = [];
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const now = value();
    if (before) for (let i = 0; i < N * N; i++) if (now.has(i) !== before.has(i)) pops.push({ i, born: t, on: now.has(i) });
    before = now;
    while (pops.length && t - pops[0].born > 420) pops.shift();
    if (pops.length > 80) pops.splice(0, pops.length - 80);

    const k = Math.min(1, (w - 24) / SIZE), ox = Math.round((w - SIZE * k) / 2), oy = Math.round((h - SIZE * k) / 2);
    // Wallpaper: the same form, 64 px to a tile. Every tile changes with each box.
    const TILE = 64;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.3;
    for (let y = oy % TILE - TILE; y < h; y += TILE) for (let x = ox % TILE - TILE; x < w; x += TILE) put(ctx, form, x, y, TILE, TILE);
    ctx.globalAlpha = 1;
    // The editor: a frame, the form at full size, and grid lines that are not part of the form's picture.
    ctx.translate(ox, oy); ctx.scale(k, k);
    ctx.shadowColor = 'rgb(0 0 0 / 0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#1b1f3b'; ctx.fillRect(-6, -6, SIZE + 12, SIZE + 12);
    ctx.shadowColor = 'transparent';
    put(ctx, form, 0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgb(27 31 59 / 0.16)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < N; i++) { ctx.moveTo(i * CELL + 0.5, 0); ctx.lineTo(i * CELL + 0.5, SIZE); ctx.moveTo(0, i * CELL + 0.5); ctx.lineTo(SIZE, i * CELL + 0.5); }
    ctx.stroke();
    for (const p of pops) {
      const a = (t - p.born) / 420, r = CELL / 2 + a * 15, x = (p.i & 15) * CELL + CELL / 2, y = (p.i >> 4) * CELL + CELL / 2;
      ctx.strokeStyle = p.on ? `rgb(255 196 0 / ${1 - a})` : `rgb(0 170 255 / ${1 - a})`;
      ctx.lineWidth = 3 * (1 - a) + 0.5;
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
    // Input goes to the full-size form, not to the last wallpaper tile.
    place(ctx, form, 0, 0);
    out.textContent = `${now.size} of 256 boxes checked. Paint events: ${paints}. FormData as hex: ${hex(now)}`;
    return pops.length > 0;
  });
  // #endregion pixel-draw

  // #region pixel-pointer
  // A tap toggles a box with no script. This listener adds drawing by dragging: it writes `checked` on
  // each box the pointer crosses. The cell is found from the form's rectangle, which the browser
  // reports at the drawn place. The form has touch-action: none, and the canvas round it has pan-y.
  let stroke = null;
  const cellAt = (e) => {
    const r = form.getBoundingClientRect();
    return { c: Math.floor((e.clientX - r.left) / r.width * N), r: Math.floor((e.clientY - r.top) / r.height * N) };
  };
  const set = (c, r, on) => { if (c >= 0 && c < N && r >= 0 && r < N) boxes[r * N + c].checked = on; };
  form.addEventListener('pointerdown', (e) => {
    if (e.target.type !== 'checkbox' || !e.isPrimary || e.button) return;
    stroke = { id: e.pointerId, on: !e.target.checked, ...cellAt(e) };
    form.setPointerCapture(e.pointerId);
    set(stroke.c, stroke.r, stroke.on);
  });
  form.addEventListener('pointermove', (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const to = cellAt(e), steps = Math.max(Math.abs(to.c - stroke.c), Math.abs(to.r - stroke.r), 1);
    for (let s = 1; s <= steps; s++) set(Math.round(stroke.c + (to.c - stroke.c) * s / steps), Math.round(stroke.r + (to.r - stroke.r) * s / steps), stroke.on);
    stroke.c = to.c; stroke.r = to.r;
  });
  let drew = 0;
  const end = (e) => { if (stroke && e.pointerId === stroke.id) { stroke = null; drew = e.timeStamp; } };
  form.addEventListener('pointerup', end);
  form.addEventListener('pointercancel', end);
  // The pointer already wrote the box. Cancelling the click that follows keeps the browser from toggling it back.
  form.addEventListener('click', (e) => { if (e.detail > 0 && e.timeStamp - drew < 400) e.preventDefault(); });
  // #endregion pixel-pointer

  // Arrow keys move between boxes. Space toggles the focused box, which is the checkbox's own behaviour.
  form.addEventListener('keydown', (e) => {
    const i = boxes.indexOf(e.target), d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -N, ArrowDown: N }[e.key];
    if (i < 0 || !d) return;
    e.preventDefault();
    boxes[Math.min(N * N - 1, Math.max(0, i + d))].focus();
  });
  // One box is in the tab order at a time: the one that had focus last.
  boxes.forEach((b, i) => { b.tabIndex = i ? -1 : 0; });
  form.addEventListener('focusin', (e) => { for (const b of boxes) b.tabIndex = b === e.target ? 0 : -1; });
  document.getElementById('pixelClear').addEventListener('click', () => { for (const b of boxes) b.checked = false; });
  document.getElementById('pixelInvert').addEventListener('click', () => { for (const b of boxes) b.checked = !b.checked; });
  fresh(form);
  return { stage };
}
