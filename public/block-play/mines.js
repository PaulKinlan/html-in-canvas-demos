import { mount, place, colors, clamp } from '/form-state/kit.js';
import { lay, piece } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('minesCanvas'), table = document.getElementById('minesTable'), out = document.getElementById('minesOut');
  const flagMode = document.getElementById('minesFlag');
  const N = 8, MINES = 9;
  // #region mines-table
  // The board is a real table: 8 rows of 8 cells, a <button> in each.
  for (let r = 0; r < N; r++) {
    const row = table.insertRow();
    for (let c = 0; c < N; c++) { const b = document.createElement('button'); b.type = 'button'; b.dataset.r = r; b.dataset.c = c; b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, covered`); row.insertCell().append(b); }
  }
  // #endregion mines-table
  const cells = [...table.querySelectorAll('button')], cell = (r, c) => cells[r * N + c];
  const around = (r, c) => { const list = []; for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if ((y !== r || x !== c) && y >= 0 && x >= 0 && y < N && x < N) list.push([y, x]); return list; };
  let mines = null, open = new Set(), flags = new Set(), queue = [], pops = new Map(), wave = null, state = 'ready', shake = -1e9;
  const key = (r, c) => r * N + c;
  function lay_mines(r0, c0) {
    mines = new Set();
    const safe = new Set([key(r0, c0), ...around(r0, c0).map(([r, c]) => key(r, c))]);
    while (mines.size < MINES) { const k = Math.floor(Math.random() * N * N); if (!safe.has(k)) mines.add(k); }
  }
  const near = (r, c) => around(r, c).filter(([y, x]) => mines.has(key(y, x))).length;
  // #region mines
  // A tap finds every cell it opens (a flood fill from the tapped cell) and gives each one a time: 45 ms
  // for each cell of distance. The paint handler opens the cells whose time has come, by changing the
  // real buttons, and draws each newly opened cell once more, enlarged, for 0.25 s, with a ring that
  // travels outward at the same speed.
  const RATE = 45;
  function reveal(r0, c0) {
    if (!mines) lay_mines(r0, c0);
    const t = performance.now(), seen = new Set([key(r0, c0)]), todo = [[r0, c0]];
    wave = { r: r0, c: c0, t };
    if (mines.has(key(r0, c0))) {
      state = 'lost'; shake = t;
      for (const k of mines) queue.push({ k, at: t + Math.hypot(Math.floor(k / N) - r0, (k % N) - c0) * RATE });
    } else {
      while (todo.length) {
        const [r, c] = todo.shift();
        if (open.has(key(r, c)) || flags.has(key(r, c))) continue;
        queue.push({ k: key(r, c), at: t + Math.hypot(r - r0, c - c0) * RATE });
        if (near(r, c) === 0) for (const [y, x] of around(r, c)) if (!seen.has(key(y, x))) { seen.add(key(y, x)); todo.push([y, x]); }
      }
    }
    stage.request();
  }
  function show(k, t) {
    const b = cells[k], r = Math.floor(k / N), c = k % N;
    open.add(k); pops.set(k, t);
    b.disabled = true; b.classList.add('open');
    if (mines.has(k)) { b.textContent = '✹'; b.classList.add('mine'); b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, a mine`); return; }
    const n = near(r, c);
    b.textContent = n ? String(n) : ''; b.dataset.n = n;
    b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, ${n} mines near`);
    if (state === 'playing' && open.size === N * N - MINES) state = 'won';
  }
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const due = queue.filter((q) => q.at <= t);
    queue = queue.filter((q) => q.at > t);
    for (const q of due) if (!open.has(q.k)) show(q.k, t);
    for (const [k, at] of pops) if (t - at > 250) pops.delete(k);
    const sh = t - shake < 420 ? Math.sin((t - shake) / 22) * 7 * (1 - (t - shake) / 420) : 0;
    lay(ctx, canvas, table, w, h, ({ W, H }) => {
      ctx.translate(sh, 0);
      piece(ctx, table, 0, 0, W, H);
      for (const [k, at] of pops) {
        const b = cells[k], td = b.parentNode, u = clamp((t - at) / 250), s = 1 + 0.55 * Math.sin(u * Math.PI);
        const x = td.offsetLeft, y = td.offsetTop, cw = td.offsetWidth, chh = td.offsetHeight;
        ctx.save();
        ctx.translate(x + cw / 2, y + chh / 2); ctx.scale(s, s); ctx.translate(-x - cw / 2, -y - chh / 2);
        piece(ctx, table, x, y, cw, chh);
        ctx.restore();
      }
      if (wave && t - wave.t < 900) {
        const td = cell(wave.r, wave.c).parentNode, R = ((t - wave.t) / RATE) * td.offsetWidth;
        ctx.strokeStyle = state === 'lost' ? c.bad : c.accent; ctx.globalAlpha = 1 - (t - wave.t) / 900; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(td.offsetLeft + td.offsetWidth / 2, td.offsetTop + td.offsetHeight / 2, R, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      place(ctx, table, 0, 0);
    });
    const words = { ready: 'Tap a cell.', playing: 'Playing.', won: 'Cleared: every cell without a mine is open.', lost: 'A mine. Press New game.' }[state];
    out.textContent = `Open: ${open.size} of ${N * N - MINES} safe cells. Flags: ${flags.size} of ${MINES} mines. ${words}`;
    return queue.length > 0 || pops.size > 0 || (wave && t - wave.t < 900) || t - shake < 420;
  });
  // #endregion mines
  table.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state === 'won' || state === 'lost') return;
    const r = Number(b.dataset.r), c = Number(b.dataset.c), k = key(r, c);
    if (flagMode.checked) {
      if (flags.has(k)) { flags.delete(k); b.textContent = ''; } else { flags.add(k); b.textContent = '⚑'; }
      b.classList.toggle('flag', flags.has(k)); stage.request(); return;
    }
    if (flags.has(k)) return;
    if (state === 'ready') state = 'playing';
    reveal(r, c);
  });
  document.getElementById('minesNew').addEventListener('click', () => {
    mines = null; open = new Set(); flags = new Set(); queue = []; pops = new Map(); wave = null; state = 'ready';
    cells.forEach((b, i) => { b.disabled = false; b.className = ''; b.textContent = ''; delete b.dataset.n; b.setAttribute('aria-label', `Row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}, covered`); });
    stage.request();
  });
  return { stage };
}
