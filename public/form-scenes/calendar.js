import { put, hitOnly, snapshot, reducedMotion, clamp } from '/lib/stage-2d.js';
import { scene, query } from './scene.js';

export default function start() {
  const canvas = document.getElementById('calCanvas');
  const form = document.getElementById('calForm');
  const date = document.getElementById('calDate');
  const month = document.getElementById('calMonth');
  const grid = document.getElementById('calGrid');
  const prev = document.getElementById('calPrev');
  const next = document.getElementById('calNext');
  const out = document.getElementById('calOut');
  const W = 380, H = 476;
  const SHEET = { x: 30, y: 26, w: 320, h: 396 };
  const GRID = { x: SHEET.x, y: SHEET.y + 126, cw: SHEET.w / 7, ch: 44 };
  const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (!date.value) date.value = today;
  month.value = date.value.slice(0, 7);

  // The first cell of a month's sheet: the Monday on or before the 1st.
  const firstCell = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    return new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 864e5);
  };

  // #region calendar-sheet
  // One sheet of the calendar. The month name, the grid and the pen ring are canvas drawing.
  // `fields` is the two inputs, or two pictures of them taken earlier with captureElementImage().
  function sheet(ctx, ym, picked, ring, fields) {
    const [y, m] = ym.split('-').map(Number);
    const { x, y: top, w, h } = SHEET;
    ctx.fillStyle = '#fffdf6'; ctx.strokeStyle = '#00000030'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, top, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = `hsl(${(m * 30 + 340) % 360} 52% 40%)`;
    ctx.fillRect(x, top, w, 100);
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath(); ctx.arc(x + w / 2, top + 12, 5, 0, 7); ctx.fill();
    ctx.font = '700 24px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(NAMES[m - 1], x + 12, top + 42);
    ctx.textAlign = 'right'; ctx.font = '400 20px system-ui, sans-serif';
    ctx.fillText(String(y), x + w - 12, top + 42);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = '#6b6760';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => ctx.fillText(d, GRID.x + (i + 0.5) * GRID.cw, top + 114));
    const start = firstCell(ym).getTime();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start + i * 864e5), text = iso(d);
      const cx = GRID.x + (i % 7 + 0.5) * GRID.cw, cy = GRID.y + (Math.floor(i / 7) + 0.5) * GRID.ch;
      const inMonth = d.getUTCMonth() === m - 1;
      ctx.font = `${inMonth ? 600 : 400} 16px system-ui, sans-serif`;
      ctx.fillStyle = !inMonth ? '#b9b4aa' : i % 7 > 4 ? '#b3261e' : '#1d1c1a';
      ctx.fillText(String(d.getUTCDate()), cx, cy);
      if (text === today) { ctx.strokeStyle = '#1d1c1a'; ctx.lineWidth = 1; ctx.strokeRect(cx - 17, cy - 17, 34, 34); }
      if (text === picked && ring > 0) {
        // A ring as a pen would draw it: a little more than one turn, with an uneven radius.
        ctx.strokeStyle = '#d21f3c'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let a = 0; a <= 7 * ring; a += 0.15) {
          const r = 18 + Math.sin(a * 2.3 + d.getUTCDate()) * 1.6 - a * 0.25;
          const px = cx + Math.cos(a - 2.2) * r * 1.08, py = cy + Math.sin(a - 2.2) * r;
          if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    }
    const at = [[date, x + 8, top + 54], [month, x + 152, top + 54]];
    at.forEach(([el, ex, ey], i) => {
      if (fields === 'live') put(ctx, el, ex, ey);
      else if (fields[i]) ctx.drawElementImage(fields[i], ex, ey, el.offsetWidth, el.offsetHeight);
    });
  }
  // #endregion calendar-sheet

  // #region calendar-turn
  // The inputs are the state: `shown` is the last valid value of the month input.
  let shown = month.value, falling = null, held = [], ringFrom = 0, torn = 0;

  // The sheet of the old month is torn off. It carries the pictures of the inputs from the last paint,
  // which still show the old values, while the live inputs on the sheet below show the new ones.
  function turn(to) {
    if (!/^\d{4}-\d\d$/.test(to) || to === shown) return;
    falling?.fields.forEach((f) => f?.close());
    falling = { ym: shown, picked: date.value, fields: held, from: performance.now(), side: to > shown ? 1 : -1 };
    held = [];
    if (reducedMotion()) { falling.fields.forEach((f) => f?.close()); falling = null; }
    shown = to;
    torn++;
    names();
  }

  const stage = scene(canvas, W, H, (ctx, t) => {
    // The wall: a nail, and the edges of the sheets still to come.
    ctx.fillStyle = '#00000022';
    ctx.fillRect(SHEET.x + 6, SHEET.y + 6, SHEET.w, SHEET.h);
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(SHEET.x + 3, SHEET.y + 3, SHEET.w, SHEET.h);

    const ring = reducedMotion() ? 1 : clamp((t - ringFrom) / 350);
    sheet(ctx, shown, date.value, ring, 'live');
    put(ctx, grid, GRID.x, GRID.y);
    put(ctx, prev, SHEET.x, 430);
    put(ctx, next, SHEET.x + SHEET.w - next.offsetWidth, 430);

    let more = ring < 1;
    if (falling) {
      const p = (t - falling.from) / 900;
      if (p >= 1) { falling.fields.forEach((f) => f?.close()); falling = null; } else {
        const cornerX = falling.side > 0 ? SHEET.x : SHEET.x + SHEET.w;
        ctx.save();
        ctx.translate(cornerX + falling.side * 50 * p, SHEET.y + 620 * p ** 2.4);
        ctx.rotate(falling.side * 0.9 * p * p);
        ctx.translate(-cornerX, -SHEET.y);
        sheet(ctx, falling.ym, falling.picked, 1, falling.fields);
        ctx.restore();
        // Drawing a picture of an input moved that input's hit region onto the falling sheet.
        // A draw with no alpha puts it back on the sheet below.
        hitOnly(ctx, date, SHEET.x + 8, SHEET.y + 54);
        hitOnly(ctx, month, SHEET.x + 152, SHEET.y + 54);
        more = true;
      }
    }
    // Keep one picture of each input as it looks now, for the next sheet that is torn off.
    if (!falling || !held.length) {
      held.forEach((f) => f?.close());
      held = [snapshot(canvas, date), snapshot(canvas, month)];
    }
    ctx.fillStyle = '#8a8580';
    ctx.beginPath(); ctx.arc(SHEET.x + SHEET.w / 2, SHEET.y + 12, 3, 0, 7); ctx.fill();
    return more;
  });
  // #endregion calendar-turn

  // #region calendar-events
  const report = () => { out.textContent = `Form value: ${query(form)}\nSheets torn off: ${torn}`; stage.request(); };
  const names = () => {
    const [, m] = shown.split('-').map(Number);
    prev.textContent = `‹ ${NAMES[(m + 10) % 12]}`;
    next.textContent = `${NAMES[m % 12]} ›`;
  };
  // Typing in the date input, or its native picker, moves the calendar to that month.
  date.addEventListener('input', () => {
    if (date.value) { ringFrom = performance.now(); month.value = date.value.slice(0, 7); turn(month.value); }
    report();
  });
  month.addEventListener('input', () => { turn(month.value); report(); });
  // The buttons step the month input. stepUp() raises no input event, so the page calls turn() itself.
  const stepMonth = (by) => { if (!month.value) month.value = shown; by > 0 ? month.stepUp() : month.stepDown(); turn(month.value); report(); };
  prev.addEventListener('click', () => stepMonth(-1));
  next.addEventListener('click', () => stepMonth(1));
  // A tap on the drawn grid writes the date input's value.
  grid.addEventListener('click', (e) => {
    const [x, y] = stage.point(e);
    const col = Math.floor((x - GRID.x) / GRID.cw), row = Math.floor((y - GRID.y) / GRID.ch);
    if (col < 0 || col > 6 || row < 0 || row > 5) return;
    date.value = iso(new Date(firstCell(shown).getTime() + (row * 7 + col) * 864e5));
    date.dispatchEvent(new Event('input', { bubbles: true }));
    date.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // #endregion calendar-events
  form.addEventListener('submit', (e) => e.preventDefault());
  names();
  report();
  return { stage, turn };
}
